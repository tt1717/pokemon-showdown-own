/**
 * Ladder library
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * This file handles ladders for all servers other than
 * play.pokemonshowdown.com.
 *
 * Specifically, this is the file that handles calculating and keeping
 * track of players' Elo ratings for all formats.
 *
 * Matchmaking is currently still implemented in rooms.ts.
 *
 * @license MIT
 */

import { FS, Utils } from '../lib';

// ladderCaches = {formatid: ladder OR Promise(ladder)}
// Use Ladders(formatid).ladder to guarantee a Promise(ladder).
// ladder is basically a 2D array representing the corresponding ladder.tsv
//   with userid in front
/** [userid, eloRating, username, w, l, t, glickoRating, ratingDeviation, gxe, gamesPlayed, lastUpdate, h2hData] */
type LadderRow = [string, number, string, number, number, number, number, number, number | string, number, string, string];
/** formatid: ladder */
type LadderCache = Map<string, LadderRow[] | Promise<LadderRow[]>>;

const ladderCaches: LadderCache = new Map();

export class LadderStore {
	formatid: string;
	ladder: LadderRow[] | null;
	ladderPromise: Promise<LadderRow[]> | null;
	saving: boolean;
	static readonly formatsListPrefix = '|,LL';
	static readonly ladderCaches = ladderCaches;

	constructor(formatid: string) {
		this.formatid = formatid;
		this.ladder = null;
		this.ladderPromise = null;
		this.saving = false;
	}

	getLadder() {
		if (!this.ladderPromise) this.ladderPromise = this.load();
		return this.ladderPromise;
	}

	/**
	 * Internal function, returns a Promise for a ladder
	 */
	async load() {
		// ladderCaches[formatid]
		const cachedLadder = ladderCaches.get(this.formatid);
		if (cachedLadder) {
			if ((cachedLadder as Promise<LadderRow[]>).then) {
				const ladder = await cachedLadder;
				return (this.ladder = ladder);
			}
			return (this.ladder = cachedLadder as LadderRow[]);
		}
		try {
			const data = await FS('config/ladders/' + this.formatid + '.tsv').readIfExists();
			const ladder: LadderRow[] = [];
			for (const dataLine of data.split('\n').slice(1)) {
				const line = dataLine.trim();
				if (!line) continue;
				const row = line.split('\t');
				// Handle both old and new format
				if (row.length >= 9) {
					// New format with Glicko-1 and additional stats
					ladder.push([
						toID(row[1]), Number(row[0]), row[1], Number(row[2]), Number(row[3]), Number(row[4]),
						Number(row[5]) || 130, Number(row[6]) || 50, Number(row[7]) || (Number(row[2]) + Number(row[3]) + Number(row[4])),
						row[8], row[9] || '{}'
					]);
				} else {
					// Old format - calculate missing values
					const games = Number(row[2]) + Number(row[3]) + Number(row[4]);
					const winRate = games > 0 ? Number(row[2]) / games : 0.5;
					const rd = Math.max(30, 130 - games * 2); // Rating deviation decreases with games
					const gxe = this.calculateGXE(Number(row[0]), rd);
					ladder.push([
						toID(row[1]), Number(row[0]), row[1], Number(row[2]), Number(row[3]), Number(row[4]),
						rd, gxe, games, row[5], '{}'
					]);
				}
			}
			// console.log('Ladders(' + this.formatid + ') loaded tsv: ' + JSON.stringify(this.ladder));
			ladderCaches.set(this.formatid, (this.ladder = ladder));
			return this.ladder;
		} catch {
			// console.log('Ladders(' + this.formatid + ') err loading tsv: ' + JSON.stringify(this.ladder));
		}
		ladderCaches.set(this.formatid, (this.ladder = []));
		return this.ladder;
	}

	/**
	 * Saves the ladder in config/ladders/[formatid].tsv
	 *
	 * Called automatically by updateRating, so you don't need to manually
	 * call this.
	 */
	async save() {
		if (this.saving) return;
		this.saving = true;
		const ladder = await this.getLadder();
		if (!ladder.length) {
			this.saving = false;
			return;
		}
		const stream = FS(`config/ladders/${this.formatid}.tsv`).createWriteStream();
		void stream.write('Elo\tUsername\tW\tL\tT\tGlicko\tRating_Deviation\tGXE\tGames_Played\tLast_update\tH2H_Data\r\n');
		for (const row of ladder) {
			void stream.write(row.slice(1).join('\t') + '\r\n');
		}
		void stream.writeEnd();
		this.saving = false;
	}

	/**
	 * Gets the index of a user in the ladder array.
	 *
	 * If createIfNeeded is true, the user will be created and added to
	 * the ladder array if it doesn't already exist.
	 */
	indexOfUser(username: string, createIfNeeded = false) {
		if (!this.ladder) throw new Error(`Must be called with ladder loaded`);
		const userid = toID(username);
		for (const [i, user] of this.ladder.entries()) {
			if (user[0] === userid) return i;
		}
		if (createIfNeeded) {
			const index = this.ladder.length;
			this.ladder.push([userid, 1000, username, 0, 0, 0, 1500, 130, 50, 0, new Date().toString(), '{}']);
			return index;
		}
		return -1;
	}

	/**
	 * Returns [formatid, html], where html is an the HTML source of a
	 * ladder toplist, to be displayed directly in the ladder tab of the
	 * client.
	 */
	async getTop(prefix?: string) {
		const formatid = this.formatid;
		const name = Dex.formats.get(formatid).name;
		const ladder = await this.getLadder();
		let buf = `<h3>${name} Top 100</h3>`;
		buf += `<table>`;
		buf += `<tr><th>` + ['', 'Username', '<abbr title="ELO Rating">ELO</abbr>', '<abbr title="Glicko X-Act Estimate">GXE</abbr>', '<abbr title="Glicko-1 Rating">Glicko-1</abbr>', '<abbr title="Glicko-1 Deviation">Glicko-1 Deviation</abbr>', 'Win', 'Loss', 'Tie'].join(`</th><th>`) + `</th></tr>`;
		for (const [i, row] of ladder.entries()) {
			if (prefix && !row[0].startsWith(prefix)) continue;
			const gxeDisplay = typeof row[8] === 'string' ? row[8] : `${row[8]}%`;
			buf += `<tr><td>` + [
				i + 1, row[2], `<strong>${Math.round(row[1])}</strong>`, gxeDisplay, Math.round(row[6]), Math.round(row[7]), row[3], row[4], row[5],
			].join(`</td><td>`) + `</td></tr>`;
		}
		return [formatid, buf];
	}

	/**
	 * Returns a Promise for the Elo rating of a user
	 */
	async getRating(userid: string) {
		const formatid = this.formatid;
		const user = Users.getExact(userid);
		if (user?.mmrCache[formatid]) {
			return user.mmrCache[formatid];
		}
		const ladder = await this.getLadder();
		const index = this.indexOfUser(userid);
		let rating = 1000;
		if (index >= 0) {
			rating = ladder[index][1];
		}
		if (user && user.id === userid) {
			user.mmrCache[formatid] = rating;
		}
		return rating;
	}

	/**
	 * Internal method. Update the Elo rating of a user.
	 */
	updateRow(row: LadderRow, score: number, foeElo: number, foeGlicko: number, foeRd: number = 130) {
		let eloRating = row[1];
		let glickoRating = row[6];
		let rd = row[7];
		let games = row[9];

		// Update ELO rating (familiar system)
		const newElo = this.calculateElo(eloRating, score, foeElo, games);
		
		// Update Glicko-1 system (for statistical accuracy)
		const [newGlickoRating, newRd] = this.calculateGlicko(glickoRating, rd, foeGlicko, foeRd, score);
		
		// Update games played
		games++;

		// Calculate GXE based on Glicko-1 rating and RD (this is the correct approach)
		const gxe = this.calculateGXE(newGlickoRating, newRd);

		// Update the row
		row[1] = newElo; // ELO rating (with 1000 floor)
		row[6] = newGlickoRating; // Glicko-1 rating
		row[7] = newRd; // Glicko rating deviation
		row[8] = gxe; // GXE (based on Glicko)
		row[9] = games; // Games played
		
		if (score > 0.6) {
			row[3]++; // win
		} else if (score < 0.4) {
			row[4]++; // loss
		} else {
			row[5]++; // tie
		}
		row[10] = new Date().toString();
	}

	/**
	 * Update the Elo rating for two players after a battle, and display
	 * the results in the passed room.
	 */
	async updateRating(p1name: string, p2name: string, p1score: number, room: AnyObject) {
		if (Ladders.disabled) {
			room.addRaw(`Ratings not updated. The ladders are currently disabled.`).update();
			return [p1score, null, null];
		}

		const formatid = this.formatid;
		let p2score = 1 - p1score;
		if (p1score < 0) {
			p1score = 0;
			p2score = 0;
		}
		const ladder = await this.getLadder();

		let p1newElo;
		let p2newElo;
		try {
			const p1index = this.indexOfUser(p1name, true);
			const p1elo = ladder[p1index][1];
			const p1glicko = ladder[p1index][6];
			const p1rd = ladder[p1index][7];

			let p2index = this.indexOfUser(p2name, true);
			const p2elo = ladder[p2index][1];
			const p2glicko = ladder[p2index][6];
			const p2rd = ladder[p2index][7];

			this.updateRow(ladder[p1index], p1score, p2elo, p2glicko, p2rd);
			this.updateRow(ladder[p2index], p2score, p1elo, p1glicko, p1rd);

			// Update head-to-head statistics
			const p1id = toID(p1name);
			const p2id = toID(p2name);
			
			if (p1score > 0.6) {
				// P1 wins
				this.updateH2H(ladder[p1index], p2id, 'win');
				this.updateH2H(ladder[p2index], p1id, 'loss');
			} else if (p1score < 0.4) {
				// P1 loses (P2 wins)
				this.updateH2H(ladder[p1index], p2id, 'loss');
				this.updateH2H(ladder[p2index], p1id, 'win');
			} else {
				// Tie
				this.updateH2H(ladder[p1index], p2id, 'tie');
				this.updateH2H(ladder[p2index], p1id, 'tie');
			}

			p1newElo = ladder[p1index][1];
			p2newElo = ladder[p2index][1];

			// console.log('L: ' + ladder.map(r => ''+Math.round(r[1])+' '+r[2]).join('\n'));

			// move p1 to its new location
			let newIndex = p1index;
			while (newIndex > 0 && ladder[newIndex - 1][1] <= p1newElo) newIndex--;
			while (newIndex === p1index || (ladder[newIndex] && ladder[newIndex][1] > p1newElo)) newIndex++;
			// console.log('ni='+newIndex+', p1i='+p1index);
			if (newIndex !== p1index && newIndex !== p1index + 1) {
				const row = ladder.splice(p1index, 1)[0];
				// adjust for removed row
				if (newIndex > p1index) newIndex--;
				if (p2index > p1index) p2index--;

				ladder.splice(newIndex, 0, row);
				// adjust for inserted row
				if (p2index >= newIndex) p2index++;
			}

			// move p2
			newIndex = p2index;
			while (newIndex > 0 && ladder[newIndex - 1][1] <= p2newElo) newIndex--;
			while (newIndex === p2index || (ladder[newIndex] && ladder[newIndex][1] > p2newElo)) newIndex++;
			// console.log('ni='+newIndex+', p2i='+p2index);
			if (newIndex !== p2index && newIndex !== p2index + 1) {
				const row = ladder.splice(p2index, 1)[0];
				// adjust for removed row
				if (newIndex > p2index) newIndex--;

				ladder.splice(newIndex, 0, row);
			}

			const p1 = Users.getExact(p1name);
			if (p1) p1.mmrCache[formatid] = +p1newElo;
			const p2 = Users.getExact(p2name);
			if (p2) p2.mmrCache[formatid] = +p2newElo;
			void this.save();

			if (!room.battle) {
				Monitor.warn(`room expired before ladder update was received`);
				return [p1score, null, null];
			}

			let reasons = `${Math.round(p1newElo) - Math.round(p1elo)} for ${p1score > 0.9 ? 'winning' : (p1score < 0.1 ? 'losing' : 'tying')}`;
			if (!reasons.startsWith('-')) reasons = '+' + reasons;
			room.addRaw(
				Utils.html`${p1name}'s rating: ${Math.round(p1elo)} &rarr; <strong>${Math.round(p1newElo)}</strong><br />(${reasons})`
			);

			reasons = `${Math.round(p2newElo) - Math.round(p2elo)} for ${p2score > 0.9 ? 'winning' : (p2score < 0.1 ? 'losing' : 'tying')}`;
			if (!reasons.startsWith('-')) reasons = '+' + reasons;
			room.addRaw(
				Utils.html`${p2name}'s rating: ${Math.round(p2elo)} &rarr; <strong>${Math.round(p2newElo)}</strong><br />(${reasons})`
			);

			room.update();
		} catch (e: any) {
			if (!room.battle) return [p1score, null, null];
			room.addRaw(`There was an error calculating rating changes:`);
			room.add(e.stack);
			room.update();
		}

		return [p1score, p1newElo, p2newElo];
	}

	/**
	 * Returns a promise for a <tr> with all ratings for the current format.
	 */
	async visualize(username: string) {
		const ladder = await this.getLadder();

		const index = this.indexOfUser(username, false);

		if (index < 0) return '';

		const ratings = ladder[index];

		const output = `<tr><td>${this.formatid}</td><td><strong>${Math.round(ratings[1])}</strong></td>`;
		return `${output}<td>${ratings[3]}</td><td>${ratings[4]}</td><td>${ratings[3] + ratings[4]}</td></tr>`;
	}

	/**
	 * Calculates GXE (Glicko X-Act Estimate) from rating and deviation
	 */
	calculateGXE(rating: number, rd: number): number | string {
		// GXE (GLIXARE): X-Act's formula for probability of beating a 1500/350 player
		// Reference: https://www.smogon.com/forums/threads/gxe-glixare-a-much-better-way-of-estimating-a-players-overall-rating-than-shoddys-cre.51169/
		
		// If rating deviation is too high, rating is provisional
		if (rd > 100) {
			return "Unknown";
		}
		
		// X-Act's GLIXARE formula
		const pi = Math.PI;
		const ln10 = Math.log(10);
		
		// GLIXARE Rating = round(10000 / (1 + 10^(((1500 - R) * pi / sqrt(3 * ln(10)^2 * RD^2 + 2500 * (64 * pi^2 + 147 * ln(10)^2)))))) / 100
		const numerator = (1500 - rating) * pi;
		const denominator = Math.sqrt(3 * Math.pow(ln10, 2) * Math.pow(rd, 2) + 2500 * (64 * Math.pow(pi, 2) + 147 * Math.pow(ln10, 2)));
		const exponent = numerator / denominator;
		const glixare = 10000 / (1 + Math.pow(10, exponent));
		
		return Math.round(glixare) / 100; // Round to 2 decimal places as percentage
	}

	/**
	 * Calculates new Glicko-1 rating and deviation
	 */
	calculateGlicko(rating: number, rd: number, opponentRating: number, opponentRd: number, score: number): [number, number] {
		// Glicko-1 system constants
		const q = Math.log(10) / 400;

		// Calculate g(RD) function
		const g = (deviation: number) => 1 / Math.sqrt(1 + 3 * Math.pow(q * deviation, 2) / Math.pow(Math.PI, 2));

		// Expected score
		const E = 1 / (1 + Math.pow(10, -g(opponentRd) * (rating - opponentRating) / 400));

		// d^2 calculation
		const d_squared = 1 / (Math.pow(q, 2) * Math.pow(g(opponentRd), 2) * E * (1 - E));

		// New rating
		const newRating = rating + (q / (1 / Math.pow(rd, 2) + 1 / d_squared)) * g(opponentRd) * (score - E);

		// New rating deviation (decreases with each game)
		const newRd = Math.sqrt(1 / (1 / Math.pow(rd, 2) + 1 / d_squared));

		// Ensure RD doesn't go below minimum (10) or above maximum (350)
		const finalRd = Math.max(10, Math.min(350, newRd));

		return [Math.round(newRating * 10) / 10, Math.round(finalRd * 10) / 10];
	}

	/**
	 * Calculates Elo based on a match result (improved with lower variance)
	 */
	calculateElo(oldElo: number, score: number, foeElo: number, games: number = 0): number {
		// Improved K-factor calculation for reduced variance
		let K = 32; // Base K-factor (reduced from 50)

		// Progressive K-factor reduction based on games played
		if (games < 20) {
			K = 32; // New players get higher K for faster convergence
		} else if (games < 50) {
			K = 24; // Intermediate players
		} else {
			K = 16; // Experienced players get lower K for stability
		}

		// Slight adjustment for rating ranges (less aggressive than before)
		if (oldElo < 1100) {
			K = Math.min(K + 8, 32); // Boost for very low ratings
		} else if (oldElo > 1600) {
			K = Math.max(K - 4, 12); // Reduce for very high ratings
		}

		// Anti-inflation: slightly favor the lower-rated player
		const ratingDiff = Math.abs(oldElo - foeElo);
		if (ratingDiff > 200) {
			const lowerRated = Math.min(oldElo, foeElo);
			if (oldElo === lowerRated && score > 0.5) {
				K *= 1.1; // Underdog wins get slight bonus
			} else if (oldElo !== lowerRated && score < 0.5) {
				K *= 1.05; // Favorite losses get slight penalty
			}
		}

		// main Elo formula
		const E = 1 / (1 + 10 ** ((foeElo - oldElo) / 400));

		const newElo = oldElo + K * (score - E);

		return Math.max(newElo, 1000);
	}

	/**
	 * Updates head-to-head statistics for two players
	 */
	updateH2H(playerRow: LadderRow, opponentId: string, result: 'win' | 'loss' | 'tie'): void {
		try {
			const h2hData = JSON.parse(playerRow[11] || '{}');
			if (!h2hData[opponentId]) {
				h2hData[opponentId] = { w: 0, l: 0, t: 0 };
			}
			if (result === 'win') h2hData[opponentId].w++;
			else if (result === 'loss') h2hData[opponentId].l++;
			else h2hData[opponentId].t++;
			
			playerRow[11] = JSON.stringify(h2hData);
		} catch {
			// If JSON parsing fails, reset to empty object
			playerRow[11] = '{}';
		}
	}

	/**
	 * Gets head-to-head record between two players
	 */
	getH2H(playerRow: LadderRow, opponentId: string): { w: number, l: number, t: number } | null {
		try {
			const h2hData = JSON.parse(playerRow[11] || '{}');
			return h2hData[opponentId] || null;
		} catch {
			return null;
		}
	}

	/**
	 * Returns a Promise for an array of strings of <tr>s for ladder ratings of the user
	 */
	static visualizeAll(username: string) {
		const ratings = [];
		for (const format of Dex.formats.all()) {
			if (format.searchShow) {
				ratings.push(new LadderStore(format.id).visualize(username));
			}
		}
		return Promise.all(ratings);
	}
}
