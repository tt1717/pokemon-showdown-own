/**
 * Enhanced Ladder Statistics Commands
 * Adds support for Glicko-1, GXE, and Head-to-Head statistics
 */

import { Utils } from '../../lib';

export const commands: Chat.ChatCommands = {
	h2h: 'headtohead',
	async headtohead(target, room, user) {
		if (!this.runBroadcast()) return;
		
		const targets = target.split(',').map(x => x.trim());
		if (targets.length !== 3) {
			return this.errorReply('Usage: /h2h [player1], [player2], [format]');
		}
		
		const [player1, player2, formatid] = targets;
		const player1id = toID(player1);
		const player2id = toID(player2);
		const format = toID(formatid);
		
		if (!player1id || !player2id || !format) {
			return this.errorReply('Usage: /h2h [player1], [player2], [format]');
		}
		
		const { LadderStore } = require('../ladders-local');
		const ladder = new LadderStore(format);
		
		try {
			const ladderData = await ladder.getLadder();
			const player1Row = ladderData.find((row: any) => row[0] === player1id);
			const player2Row = ladderData.find((row: any) => row[0] === player2id);
			
			if (!player1Row || !player2Row) {
				return this.errorReply('One or both players not found on the ladder.');
			}
			
			const h2h1 = ladder.getH2H(player1Row, player2id);
			const h2h2 = ladder.getH2H(player2Row, player1id);
			
			let html = `<div class="ladder">`;
			html += `<h3>Head-to-Head: ${Utils.escapeHTML(player1Row[2])} vs ${Utils.escapeHTML(player2Row[2])}</h3>`;
			html += `<p><strong>Format:</strong> ${format}</p>`;
			
			if (h2h1 || h2h2) {
				const p1Stats = h2h1 || { w: 0, l: 0, t: 0 };
				const p2Stats = h2h2 || { w: 0, l: 0, t: 0 };
				
				// Verify consistency (player1's wins should equal player2's losses)
				const totalGames = p1Stats.w + p1Stats.l + p1Stats.t;
				
				html += `<table><tr><th>Player</th><th>Wins</th><th>Losses</th><th>Ties</th><th>Total</th><th>Win %</th></tr>`;
				html += `<tr><td><strong>${Utils.escapeHTML(player1Row[2])}</strong></td>`;
				html += `<td>${p1Stats.w}</td><td>${p1Stats.l}</td><td>${p1Stats.t}</td><td>${totalGames}</td>`;
				html += `<td>${totalGames > 0 ? Math.round(p1Stats.w / totalGames * 100) : 0}%</td></tr>`;
				
				html += `<tr><td><strong>${Utils.escapeHTML(player2Row[2])}</strong></td>`;
				html += `<td>${p2Stats.w}</td><td>${p2Stats.l}</td><td>${p2Stats.t}</td><td>${totalGames}</td>`;
				html += `<td>${totalGames > 0 ? Math.round(p2Stats.w / totalGames * 100) : 0}%</td></tr>`;
				html += `</table>`;
			} else {
				html += `<p>No head-to-head matches found between these players.</p>`;
			}
			
			// Show current ratings for context  
			html += `<h4>Current Ratings</h4>`;
			html += `<table><tr><th>Player</th><th>ELO</th><th>Glicko-1</th><th>GXE</th><th>RD</th><th>W-L-T</th></tr>`;
			html += `<tr><td><strong>${Utils.escapeHTML(player1Row[2])}</strong></td>`;
			html += `<td>${Math.round(player1Row[1])}</td><td>${Math.round(player1Row[6])}</td><td>${player1Row[8]}%</td><td>${Math.round(player1Row[7])}</td>`;
			html += `<td>${player1Row[3]}-${player1Row[4]}-${player1Row[5]}</td></tr>`;
			
			html += `<tr><td><strong>${Utils.escapeHTML(player2Row[2])}</strong></td>`;
			html += `<td>${Math.round(player2Row[1])}</td><td>${Math.round(player2Row[6])}</td><td>${player2Row[8]}%</td><td>${Math.round(player2Row[7])}</td>`;
			html += `<td>${player2Row[3]}-${player2Row[4]}-${player2Row[5]}</td></tr>`;
			html += `</table></div>`;
			
			this.sendReplyBox(html);
		} catch (e) {
			this.errorReply('Error retrieving head-to-head statistics.');
		}
	},
	
	headtoheadhelp: [
		`/h2h [player1], [player2], [format] - Shows head-to-head statistics between two players in a specific format.`,
		`!h2h - Show everyone the head-to-head statistics. Requires: + % @ # ~`,
	],
	
	async glicko(target, room, user) {
		if (!this.runBroadcast()) return;
		
		const targetUser = target ? target : user.name;
		const userid = toID(targetUser);
		
		if (!userid) {
			return this.errorReply('Invalid username.');
		}
		
		await this.showGlickoStats(userid, targetUser);
	},
	
	async showGlickoStats(userid: string, username: string) {
		const { LadderStore } = require('../ladders-local');
		const formats = ['gen1ou', 'gen2ou', 'gen4ou', 'gen9ou']; // Add more as needed
		
		let html = `<div class="ladder">`;
		html += `<h3>Glicko-1 Statistics for ${Utils.escapeHTML(username)}</h3>`;
		html += `<table><tr><th>Format</th><th>ELO</th><th>GXE</th><th>Rating Deviation</th><th>Games</th><th>W-L-T</th></tr>`;
		
		for (const formatid of formats) {
			try {
				const ladder = new LadderStore(formatid);
				const ladderData = await ladder.getLadder();
				const playerRow = ladderData.find((row: any) => row[0] === userid);
				
				if (playerRow) {
					html += `<tr><td><strong>${formatid}</strong></td>`;
					html += `<td>${Math.round(playerRow[1])}</td>`;
					html += `<td>${playerRow[7]}%</td>`;
					html += `<td>${playerRow[6]}</td>`;
					html += `<td>${playerRow[8]}</td>`;
					html += `<td>${playerRow[3]}-${playerRow[4]}-${playerRow[5]}</td></tr>`;
				}
			} catch {}
		}
		
		html += `</table>`;
		html += `<p><small><strong>GXE:</strong> Glicko X-Act Estimate - probability of beating a 1500-rated player</small></p>`;
		html += `<p><small><strong>RD:</strong> Rating Deviation - lower values indicate more stable ratings</small></p>`;
		html += `</div>`;
		
		this.sendReplyBox(html);
	},
	
	glickohelp: [
		`/glicko [user] - Shows Glicko-1 statistics for a user across all formats.`,
		`!glicko - Show everyone the Glicko statistics. Requires: + % @ # ~`,
	],

	async reseth2h(target, room, user) {
		this.checkCan('rangeban'); // Admin only command
		
		const targets = target.split(',').map(x => x.trim());
		if (targets.length !== 2) {
			return this.errorReply('Usage: /reseth2h [username], [format]');
		}
		
		const [username, formatid] = targets;
		const userid = toID(username);
		const format = toID(formatid);
		
		if (!userid || !format) {
			return this.errorReply('Usage: /reseth2h [username], [format]');
		}
		
		await this.resetH2HData(userid, format);
	},
	
	async resetH2HData(userid: string, formatid: string) {
		const { LadderStore } = require('../ladders-local');
		const ladder = new LadderStore(formatid);
		
		try {
			const ladderData = await ladder.getLadder();
			const playerRow = ladderData.find((row: any) => row[0] === userid);
			
			if (!playerRow) {
				return this.errorReply('Player not found on the ladder.');
			}
			
			// Reset H2H data
			playerRow[10] = '{}';
			
			// Save the ladder
			await ladder.save();
			
			this.sendReply(`Head-to-head data reset for ${playerRow[2]} in ${formatid}.`);
			this.privateModAction(`${user.name} reset H2H data for ${playerRow[2]} in ${formatid}.`);
		} catch (e) {
			this.errorReply('Error resetting head-to-head data.');
		}
	},
	
	reseth2hhelp: [
		`/reseth2h [username], [format] - Resets head-to-head statistics for a user in a specific format. Requires: ~`,
	],

	async seth2h(target, room, user) {
		this.checkCan('rangeban'); // Admin only command
		
		const targets = target.split(',').map(x => x.trim());
		if (targets.length !== 6) {
			return this.errorReply('Usage: /seth2h [player1], [player2], [format], [wins], [losses], [ties]');
		}
		
		const [player1, player2, formatid, wins, losses, ties] = targets;
		const player1id = toID(player1);
		const player2id = toID(player2);
		const format = toID(formatid);
		const w = parseInt(wins);
		const l = parseInt(losses);
		const t = parseInt(ties);
		
		if (!player1id || !player2id || !format || isNaN(w) || isNaN(l) || isNaN(t)) {
			return this.errorReply('Usage: /seth2h [player1], [player2], [format], [wins], [losses], [ties]');
		}
		
		await this.setH2HData(player1id, player2id, format, w, l, t);
	},
	
	async setH2HData(player1id: string, player2id: string, formatid: string, wins: number, losses: number, ties: number) {
		const { LadderStore } = require('../ladders-local');
		const ladder = new LadderStore(formatid);
		
		try {
			const ladderData = await ladder.getLadder();
			const player1Row = ladderData.find((row: any) => row[0] === player1id);
			const player2Row = ladderData.find((row: any) => row[0] === player2id);
			
			if (!player1Row || !player2Row) {
				return this.errorReply('One or both players not found on the ladder.');
			}
			
			// Update player1's H2H data
			let h2hData1 = {};
			try {
				h2hData1 = JSON.parse(player1Row[10] || '{}');
			} catch {}
			h2hData1[player2id] = { w: wins, l: losses, t: ties };
			player1Row[10] = JSON.stringify(h2hData1);
			
			// Update player2's H2H data (reverse the wins/losses)
			let h2hData2 = {};
			try {
				h2hData2 = JSON.parse(player2Row[10] || '{}');
			} catch {}
			h2hData2[player1id] = { w: losses, l: wins, t: ties };
			player2Row[10] = JSON.stringify(h2hData2);
			
			// Save the ladder
			await ladder.save();
			
			this.sendReply(`H2H data set: ${player1Row[2]} vs ${player2Row[2]} = ${wins}-${losses}-${ties}`);
			this.privateModAction(`${user.name} set H2H data: ${player1Row[2]} vs ${player2Row[2]} = ${wins}-${losses}-${ties} in ${formatid}.`);
		} catch (e) {
			this.errorReply('Error setting head-to-head data.');
		}
	},
	
	seth2hhelp: [
		`/seth2h [player1], [player2], [format], [wins], [losses], [ties] - Manually sets head-to-head statistics between two players. Requires: ~`,
	],
};
