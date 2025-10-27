/**
 * Bracket Tournament Manager
 * Handles single-elimination tournament brackets with thread-safe CSV persistence
 */

import {toID} from '../sim/dex';
import {FS} from '../lib/fs';

interface BracketMatch {
	round: number;
	matchId: number;
	player1: ID;
	player2: ID;
	/** Display names with original formatting */
	player1Display: string;
	player2Display: string;
	p1wins: number;
	p2wins: number;
	status: 'pending' | 'waiting' | 'active' | 'complete';
	winner: ID | null;
	/** Winner's display name */
	winnerDisplay: string | null;
	/** Timestamp when match became active */
	startTime?: number;
}

interface BracketState {
	format: string;
	participants: number;
	bestOf: number;
	currentRound: number;
	matches: BracketMatch[];
	/** Map of userid -> current match */
	playerMatches: Map<ID, BracketMatch>;
	/** Map of userid -> display name (preserves original capitalization/formatting) */
	displayNames: Map<ID, string>;
	initialized: boolean;
	/** If true, prevents advancement to next round */
	frozen: boolean;
}

export class BracketManager {
	private state: BracketState;
	private csvPath: string;
	private writeLock: Promise<void>;
	private isWriting: boolean;

	constructor() {
		this.csvPath = 'config/bracket.csv';
		this.writeLock = Promise.resolve();
		this.isWriting = false;
		this.state = {
			format: '',
			participants: 0,
			bestOf: 0,
			currentRound: 0,
			matches: [],
			playerMatches: new Map(),
			displayNames: new Map(),
			initialized: false,
			frozen: false,
		};
	}

	/**
	 * Initialize a new bracket tournament
	 */
	async initialize(format: string, players: string[], bestOf: number, randomize: boolean): Promise<void> {
		if (this.state.initialized) {
			throw new Error('Bracket already initialized. Use /resetbracket to start over.');
		}

		// Validate inputs
		const numPlayers = players.length;
		if (numPlayers < 2 || !this.isPowerOfTwo(numPlayers)) {
			throw new Error(`Number of players must be a power of 2 (2, 4, 8, 16, 32, etc.). Got ${numPlayers}`);
		}

		// Randomize seeding if requested
		const seededPlayers = randomize ? this.shuffleArray([...players]) : [...players];

		// Initialize state
		this.state.format = format;
		this.state.participants = numPlayers;
		this.state.bestOf = bestOf;
		this.state.currentRound = 1;
		this.state.matches = [];
		this.state.playerMatches.clear();
		this.state.displayNames.clear();

		// Store display names for all players
		for (const player of seededPlayers) {
			this.state.displayNames.set(toID(player), player);
		}

		// Generate first round matches with standard tournament seeding
		// Standard seeding pairs: (1,N), (N/2,N/2+1), (2,N-1), (N/2-1,N/2+2), etc.
		// For 4: (1,4), (2,3)
		// For 8: (1,8), (4,5), (2,7), (3,6)
		const standardPairings = this.generateStandardPairings(numPlayers);
		const numMatches = numPlayers / 2;
		
		for (let i = 0; i < numMatches; i++) {
			const [seed1, seed2] = standardPairings[i];
			const p1Name = seededPlayers[seed1 - 1];
			const p2Name = seededPlayers[seed2 - 1];
			const match: BracketMatch = {
				round: 1,
				matchId: i + 1,
				player1: toID(p1Name), // Convert 1-based seed to 0-based index
				player2: toID(p2Name),
				player1Display: p1Name,
				player2Display: p2Name,
				p1wins: 0,
				p2wins: 0,
				status: 'active',
				winner: null,
				winnerDisplay: null,
			};
			this.state.matches.push(match);
			this.state.playerMatches.set(match.player1, match);
			this.state.playerMatches.set(match.player2, match);
		}

		// Generate placeholder matches for future rounds
		const totalRounds = Math.log2(numPlayers);
		let nextMatchId = numMatches + 1;
		for (let round = 2; round <= totalRounds; round++) {
			const matchesInRound = Math.pow(2, totalRounds - round);
			for (let i = 0; i < matchesInRound; i++) {
				const match: BracketMatch = {
					round,
					matchId: nextMatchId++,
					player1: '' as ID,
					player2: '' as ID,
					player1Display: '',
					player2Display: '',
					p1wins: 0,
					p2wins: 0,
					status: 'pending',
					winner: null,
					winnerDisplay: null,
				};
				this.state.matches.push(match);
			}
		}

		this.state.initialized = true;

		// Persist to CSV
		await this.saveToCSV();

		Monitor.log(`[BRACKET] Initialized ${numPlayers}-player bracket for ${format}`);
		Monitor.log(`[BRACKET] Best of ${bestOf} (first to ${Math.floor(bestOf / 2) + 1} wins)`);
		Monitor.log(`[BRACKET] Round 1 matches: ${this.state.matches.slice(0, numMatches).map(m => 
			`${m.player1Display} vs ${m.player2Display}`
		).join(', ')}`);
	}

	/**
	 * Load bracket state from CSV (on server restart)
	 */
	async loadFromCSV(): Promise<boolean> {
		try {
			const data = await FS(this.csvPath).readIfExists();
			if (!data) return false;

			const lines = data.split('\n').filter(line => line.trim());
			if (lines.length < 3) return false; // Need metadata + header + at least one match

			// Parse metadata line (starts with #)
			let metadataLine = lines[0];
			let headerLine = lines[1];
			let matchLines = lines.slice(2);

			// If first line isn't metadata, fall back to old format
			if (!metadataLine.startsWith('#')) {
				Monitor.warn('[BRACKET] Loading old CSV format without metadata');
				headerLine = lines[0];
				matchLines = lines.slice(1);
				// Use config defaults
				this.state.format = Config.brackettournament.format;
				this.state.bestOf = Config.brackettournament.bestOf;
				this.state.frozen = false;
			} else {
				// Parse metadata: # format=gen1ou,bestOf=20,participants=4,frozen=false
				const metadataStr = metadataLine.substring(1).trim(); // Remove #
				const metaParts = metadataStr.split(',');
				for (const part of metaParts) {
					const [key, value] = part.split('=').map(s => s.trim());
					if (key === 'format') this.state.format = value;
					if (key === 'bestOf') this.state.bestOf = parseInt(value);
					if (key === 'participants') this.state.participants = parseInt(value);
					if (key === 'frozen') this.state.frozen = value === 'true';
				}
			}

			// Parse matches
			this.state.matches = [];
			this.state.playerMatches.clear();
			this.state.displayNames.clear();

			for (const line of matchLines) {
				const parts = line.split(',').map(s => s.trim());
				
				// Handle both old format (8 fields) and new format (11 fields)
				let round, matchId, player1, player2, player1Display, player2Display, p1wins, p2wins, status, winner, winnerDisplay;
				
				if (parts.length >= 11) {
					// New format with display names
					[round, matchId, player1, player2, player1Display, player2Display, p1wins, p2wins, status, winner, winnerDisplay] = parts;
				} else {
					// Old format - use player IDs as display names
					[round, matchId, player1, player2, p1wins, p2wins, status, winner] = parts;
					player1Display = player1;
					player2Display = player2;
					winnerDisplay = winner;
				}

				const match: BracketMatch = {
					round: parseInt(round),
					matchId: parseInt(matchId),
					player1: toID(player1),
					player2: toID(player2),
					player1Display: player1Display || '',
					player2Display: player2Display || '',
					p1wins: parseInt(p1wins) || 0,
					p2wins: parseInt(p2wins) || 0,
					status: (status || 'pending') as BracketMatch['status'],
					winner: winner ? toID(winner) : null,
					winnerDisplay: winnerDisplay || null,
				};

				this.state.matches.push(match);

				// Store display names
				if (match.player1Display) this.state.displayNames.set(match.player1, match.player1Display);
				if (match.player2Display) this.state.displayNames.set(match.player2, match.player2Display);
				if (match.winnerDisplay && match.winner) this.state.displayNames.set(match.winner, match.winnerDisplay);

				// Build player lookup map for active players
				if (match.status === 'active' || match.status === 'waiting') {
					if (match.player1) this.state.playerMatches.set(match.player1, match);
					if (match.player2) this.state.playerMatches.set(match.player2, match);
				}
			}

			// Determine current round (highest round with any activity, not just pending placeholders)
			const activeRounds = this.state.matches
				.filter(m => m.status === 'active' || m.status === 'waiting' || m.status === 'complete')
				.map(m => m.round);
			
			this.state.currentRound = activeRounds.length > 0 ? Math.max(...activeRounds) : 1;
			
			// If participants wasn't in metadata, calculate from matches
			if (!this.state.participants) {
				const firstRoundMatches = this.state.matches.filter(m => m.round === 1);
				this.state.participants = firstRoundMatches.length * 2;
			}

			this.state.initialized = true;
			Monitor.log(`[BRACKET] Loaded bracket: ${this.state.format}, Best of ${this.state.bestOf}, ${this.state.participants} players, ${this.state.matches.length} matches`);
			return true;
		} catch (err) {
			Monitor.error(`[BRACKET] Failed to load CSV: ${err}`);
			return false;
		}
	}

	/**
	 * Thread-safe CSV persistence
	 * Uses a promise chain to ensure writes are serialized
	 */
	private async saveToCSV(): Promise<void> {
		// Queue this write after any pending writes
		this.writeLock = this.writeLock.then(async () => {
			try {
				this.isWriting = true;
				
				// Build CSV content with metadata header
				const metadata = `# format=${this.state.format},bestOf=${this.state.bestOf},participants=${this.state.participants},frozen=${this.state.frozen}\n`;
				const header = 'round,matchId,player1,player2,player1Display,player2Display,p1wins,p2wins,status,winner,winnerDisplay\n';
				const rows = this.state.matches.map(m => 
					`${m.round},${m.matchId},${m.player1},${m.player2},${m.player1Display},${m.player2Display},${m.p1wins},${m.p2wins},${m.status},${m.winner || ''},${m.winnerDisplay || ''}`
				).join('\n');
				
				const content = metadata + header + rows;
				
				// Atomic write using FS.writeUpdate
				await FS(this.csvPath).writeUpdate(() => content);
				
			} catch (err) {
				Monitor.error(`[BRACKET] Failed to save CSV: ${err}`);
				throw err;
			} finally {
				this.isWriting = false;
			}
		});

		return this.writeLock;
	}

	/**
	 * Check if two users should match in the bracket
	 */
	canMatch(userid1: ID, userid2: ID): boolean {
		if (!this.state.initialized) return false;

		const match = this.state.playerMatches.get(userid1);
		if (!match) return false;
		if (match.status !== 'active') return false;

		// If bracket is frozen, only allow matches in the earliest incomplete round
		if (this.state.frozen) {
			const earliestIncompleteRound = this.getEarliestIncompleteRound();
			if (match.round !== earliestIncompleteRound) {
				return false;
			}
		}

		// Check if userid2 is the assigned opponent
		return (match.player1 === userid1 && match.player2 === userid2) ||
		       (match.player2 === userid1 && match.player1 === userid2);
	}

	/**
	 * Check if a user can search for battles
	 */
	canSearch(userid: ID): boolean {
		if (!this.state.initialized) return false;

		const match = this.state.playerMatches.get(userid);
		if (!match) {
			// Player not in bracket or eliminated
			return false;
		}

		if (match.status !== 'active' && match.status !== 'waiting') {
			return false;
		}

		// If bracket is frozen, only allow matches in the earliest incomplete round
		if (this.state.frozen) {
			const earliestIncompleteRound = this.getEarliestIncompleteRound();
			if (match.round !== earliestIncompleteRound) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Record a battle result
	 */
	async recordWin(winner: ID, loser: ID): Promise<void> {
		const match = this.state.playerMatches.get(winner);
		if (!match) {
			Monitor.warn(`[BRACKET] Win recorded for ${winner} but no active match found`);
			return;
		}

		// Verify this is the correct match
		if (!((match.player1 === winner && match.player2 === loser) ||
		      (match.player2 === winner && match.player1 === loser))) {
			Monitor.warn(`[BRACKET] Win recorded for ${winner} vs ${loser} but match is ${match.player1} vs ${match.player2}`);
			return;
		}

		// Increment wins
		if (match.player1 === winner) {
			match.p1wins++;
		} else {
			match.p2wins++;
		}

		const winsNeeded = Math.floor(this.state.bestOf / 2) + 1;
		Monitor.log(`[BRACKET] ${winner} beats ${loser} (${match.p1wins}-${match.p2wins}), need ${winsNeeded} wins`);

		// Check if match is complete
		// Note: Ties don't count - match continues until someone reaches winsNeeded
		if (match.p1wins >= winsNeeded || match.p2wins >= winsNeeded) {
			match.winner = match.p1wins >= winsNeeded ? match.player1 : match.player2;
			match.winnerDisplay = match.p1wins >= winsNeeded ? match.player1Display : match.player2Display;
			match.status = 'complete';
			
			// Remove from active player map
			this.state.playerMatches.delete(match.player1);
			this.state.playerMatches.delete(match.player2);

			Monitor.log(`[BRACKET] Match ${match.matchId} complete: ${match.winnerDisplay} wins ${match.p1wins}-${match.p2wins}`);

			// Advance winner to next round
			await this.advanceWinner(match);
		}

		// Save state
		await this.saveToCSV();
	}

	/**
	 * Advance winner to next round
	 */
	private async advanceWinner(completedMatch: BracketMatch): Promise<void> {
		const winner = completedMatch.winner!;
		const currentRound = completedMatch.round;
		const nextRound = currentRound + 1;

		// Find all matches in next round
		const nextRoundMatches = this.state.matches.filter(m => m.round === nextRound);
		
		if (nextRoundMatches.length === 0) {
			// Tournament complete!
			Monitor.log(`[BRACKET] 🏆 TOURNAMENT COMPLETE! Winner: ${winner}`);
			return;
		}

		// Check if bracket is frozen - prevent advancement to next round
		if (this.state.frozen) {
			Monitor.log(`[BRACKET] ⏸️ Tournament FROZEN - ${winner} won match ${completedMatch.matchId} but advancement blocked. Use /bracketresume to continue.`);
			return;
		}

		// In a standard single-elimination bracket:
		// Round 1 matches are numbered 1, 2, 3, 4, ...
		// Round 2 matches start after all round 1 matches
		// Match pairs (1,2) → first round 2 match, (3,4) → second round 2 match, etc.
		
		// Get the first match ID of current round
		const currentRoundMatches = this.state.matches.filter(m => m.round === currentRound);
		const firstMatchOfRound = Math.min(...currentRoundMatches.map(m => m.matchId));
		
		// Calculate which next-round match this feeds into
		// Matches 1,2 → index 0; matches 3,4 → index 1; etc.
		const relativeMatchId = completedMatch.matchId - firstMatchOfRound;
		const nextMatchIndex = Math.floor(relativeMatchId / 2);
		const nextMatch = nextRoundMatches[nextMatchIndex];

		if (!nextMatch) {
			Monitor.error(`[BRACKET] Could not find next match for completed match ${completedMatch.matchId}`);
			return;
		}

		const winnerDisplay = this.state.displayNames.get(winner) || winner;
		Monitor.log(`[BRACKET] Advancing ${winnerDisplay} from match ${completedMatch.matchId} to match ${nextMatch.matchId}`);

		// Assign winner to next match
		if (!nextMatch.player1) {
			nextMatch.player1 = winner;
			nextMatch.player1Display = winnerDisplay;
		} else if (!nextMatch.player2) {
			nextMatch.player2 = winner;
			nextMatch.player2Display = winnerDisplay;
		} else {
			Monitor.error(`[BRACKET] Next match ${nextMatch.matchId} already has both players!`);
			return;
		}

		// Check if next match is ready to start
		if (nextMatch.player1 && nextMatch.player2) {
			nextMatch.status = 'active';
			this.state.playerMatches.set(nextMatch.player1, nextMatch);
			this.state.playerMatches.set(nextMatch.player2, nextMatch);
			
			// Update current round if we're starting a new round
			if (nextRound > this.state.currentRound) {
				this.state.currentRound = nextRound;
			}
			
			Monitor.log(`[BRACKET] Round ${nextRound} match ${nextMatch.matchId} ready: ${nextMatch.player1Display} vs ${nextMatch.player2Display}`);
		} else {
			nextMatch.status = 'waiting';
			Monitor.log(`[BRACKET] ${winnerDisplay} advances to Round ${nextRound}, waiting for opponent`);
		}
	}

	/**
	 * Get bracket status for display
	 */
	getStatus(): string {
		if (!this.state.initialized) {
			return 'Bracket not initialized';
		}

		const lines = [`Bracket Tournament - ${this.state.format}`];
		lines.push(`Best of ${this.state.bestOf} (first to ${Math.floor(this.state.bestOf / 2) + 1} wins)`);
		if (this.state.frozen) {
			const earliestRound = this.getEarliestIncompleteRound();
			lines.push(`⏸️ TOURNAMENT FROZEN - Only Round ${earliestRound} can play, advancement blocked`);
		}
		lines.push('');

		// Show all rounds, including future rounds with partial data
		const maxRound = this.state.matches.length > 0 ? Math.max(...this.state.matches.map(m => m.round)) : 1;
		for (let round = 1; round <= maxRound; round++) {
			const roundMatches = this.state.matches.filter(m => m.round === round);
			if (roundMatches.length === 0) continue;
			
			lines.push(`Round ${round}:`);
			for (const match of roundMatches) {
				let status: string;
				if (match.status === 'complete') {
					// Show winner's score first, then loser's score
					const winnerWins = match.winner === match.player1 ? match.p1wins : match.p2wins;
					const loserWins = match.winner === match.player1 ? match.p2wins : match.p1wins;
					status = `✓ ${match.winnerDisplay} wins ${winnerWins}-${loserWins}`;
				} else if (match.status === 'active') {
					// Show current score
					status = `${match.p1wins}-${match.p2wins}`;
				} else if (match.status === 'waiting') {
					status = 'Waiting...';
				} else {
					status = 'TBD';
				}
				lines.push(`  Match ${match.matchId}: ${match.player1Display || 'TBD'} vs ${match.player2Display || 'TBD'} [${status}]`);
			}
			lines.push('');
		}

		return lines.join('\n');
	}

	/**
	 * Helper: Check if number is power of 2
	 */
	private isPowerOfTwo(n: number): boolean {
		return n > 0 && (n & (n - 1)) === 0;
	}

	/**
	 * Generate standard tournament bracket pairings
	 * Returns array of [seed1, seed2] pairs for first round
	 * Standard seeding ensures top seeds don't meet until finals
	 * 
	 * Examples:
	 *   4 players: [[1,4], [2,3]]
	 *   8 players: [[1,8], [4,5], [2,7], [3,6]]
	 *  16 players: [[1,16], [8,9], [4,13], [5,12], [2,15], [7,10], [3,14], [6,11]]
	 */
	private generateStandardPairings(numPlayers: number): [number, number][] {
		const pairings: [number, number][] = [];
		const numMatches = numPlayers / 2;
		
		// Build the seeding order recursively using a bracket structure
		const seeds = this.buildBracketSeeds(numPlayers);
		
		// Pair them up sequentially from the bracket seed order
		for (let i = 0; i < numMatches; i++) {
			pairings.push([seeds[i * 2], seeds[i * 2 + 1]]);
		}
		
		return pairings;
	}

	/**
	 * Build bracket seed order using recursive algorithm
	 * This creates the proper interleaving for standard tournaments
	 */
	private buildBracketSeeds(numPlayers: number): number[] {
		if (numPlayers === 2) return [1, 2];
		
		const previousRound = this.buildBracketSeeds(numPlayers / 2);
		const seeds: number[] = [];
		
		// Interleave: each seed from previous round pairs with (numPlayers + 1 - seed)
		for (const seed of previousRound) {
			seeds.push(seed);
			seeds.push(numPlayers + 1 - seed);
		}
		
		return seeds;
	}

	/**
	 * Helper: Shuffle array (Fisher-Yates)
	 */
	private shuffleArray<T>(array: T[]): T[] {
		const result = [...array];
		for (let i = result.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[result[i], result[j]] = [result[j], result[i]];
		}
		return result;
	}

	/**
	 * Load existing bracket or initialize new one based on config
	 * Called on server startup when --bracket-mode is enabled
	 */
	async loadOrInitialize(): Promise<void> {
		// Try to load existing bracket first (for crash recovery)
		const loaded = await this.loadFromCSV();
		
		if (loaded) {
			Monitor.log('[BRACKET] ✓ Resumed existing bracket from CSV');
			Monitor.log('[BRACKET] ' + this.getStatus().split('\n').slice(0, 3).join(' | '));
			return;
		}
		
		// No existing bracket - check if we should auto-initialize
		if (!Config.brackettournament.autoInit) {
			Monitor.log('[BRACKET] ⏳ Bracket mode enabled. Run /createbracket to start tournament');
			return;
		}
		
		// Auto-initialize from config
		const config = Config.brackettournament;
		
		try {
			await this.initialize(
				config.format,
				config.playerList,
				config.bestOf,
				config.randomizeSeeding
			);
			Monitor.log('[BRACKET] ✓ Auto-initialized new bracket from config');
		} catch (err) {
			Monitor.error(`[BRACKET] Failed to auto-initialize: ${err}`);
			Monitor.log('[BRACKET] Run /createbracket to manually create bracket');
		}
	}

	/**
	 * Reset bracket (for testing/admin)
	 */
	async reset(): Promise<void> {
		this.state = {
			format: '',
			participants: 0,
			bestOf: 0,
			currentRound: 0,
			matches: [],
			playerMatches: new Map(),
			displayNames: new Map(),
			initialized: false,
			frozen: false,
		};
		
		try {
			await FS(this.csvPath).unlinkIfExists();
			Monitor.log(`[BRACKET] Bracket reset and CSV deleted`);
		} catch (err) {
			Monitor.error(`[BRACKET] Failed to delete CSV: ${err}`);
		}
	}

	/**
	 * Check if bracket is initialized
	 */
	isInitialized(): boolean {
		return this.state.initialized;
	}

	/**
	 * Get current opponent for a player
	 * Returns the opponent's ID if player has an active match, null otherwise
	 */
	getOpponent(playerid: ID): ID | null {
		const match = this.state.playerMatches.get(playerid);
		if (!match) return null;
		if (match.status !== 'active') return null;
		
		// Return the other player in this match
		return match.player1 === playerid ? match.player2 : match.player1;
	}

	/**
	 * Freeze the tournament - prevents advancement to next round
	 */
	async freeze(): Promise<void> {
		if (!this.state.initialized) {
			throw new Error('No bracket currently active');
		}
		if (this.state.frozen) {
			throw new Error('Tournament is already frozen');
		}
		
		this.state.frozen = true;
		await this.saveToCSV();
		Monitor.log('[BRACKET] ⏸️ Tournament FROZEN - current round can finish, advancement blocked');
	}

	/**
	 * Resume the tournament - allows advancement to continue
	 * Advances any completed matches that were waiting
	 */
	async resume(): Promise<void> {
		if (!this.state.initialized) {
			throw new Error('No bracket currently active');
		}
		if (!this.state.frozen) {
			throw new Error('Tournament is not frozen');
		}
		
		this.state.frozen = false;
		
		// Find the total number of rounds in the tournament
		const maxRound = this.state.matches.length > 0 ? Math.max(...this.state.matches.map(m => m.round)) : 1;
		
		// Find all completed matches (excluding finals) that might need advancement
		const completedMatches = this.state.matches.filter(m => 
			m.status === 'complete' && m.winner && m.round < maxRound
		);
		
		// Advance winners that were blocked
		for (const match of completedMatches) {
			// Check if this winner needs to advance
			const nextRound = match.round + 1;
			const nextRoundMatches = this.state.matches.filter(m => m.round === nextRound);
			
			if (nextRoundMatches.length === 0) continue; // No next round (shouldn't happen given filter above)
			
			// Get the next match for this winner
			const currentRoundMatches = this.state.matches.filter(m => m.round === match.round);
			const firstMatchOfRound = Math.min(...currentRoundMatches.map(m => m.matchId));
			const relativeMatchId = match.matchId - firstMatchOfRound;
			const nextMatchIndex = Math.floor(relativeMatchId / 2);
			const nextMatch = nextRoundMatches[nextMatchIndex];
			
			if (!nextMatch) continue;
			
			// Check if winner already advanced
			if (nextMatch.player1 === match.winner || nextMatch.player2 === match.winner) {
				continue; // Already advanced
			}
			
			// Advance this winner
			if (!match.winner) continue; // Safety check (should never happen)
			const winnerDisplay = this.state.displayNames.get(match.winner) || match.winner;
			Monitor.log(`[BRACKET] Resuming - advancing ${winnerDisplay} from match ${match.matchId}`);
			await this.advanceWinner(match);
		}
		
		await this.saveToCSV();
		Monitor.log('[BRACKET] ▶️ Tournament RESUMED - advancement enabled');
	}

	/**
	 * Check if tournament is frozen
	 */
	isFrozen(): boolean {
		return this.state.frozen;
	}

	/**
	 * Get the earliest round that has incomplete matches
	 * Used to restrict play when bracket is frozen
	 */
	private getEarliestIncompleteRound(): number {
		// Find all rounds with incomplete matches (active or waiting)
		const incompleteRounds = this.state.matches
			.filter(m => m.status === 'active' || m.status === 'waiting')
			.map(m => m.round);
		
		if (incompleteRounds.length === 0) {
			// No incomplete matches, return current round
			return this.state.currentRound;
		}
		
		return Math.min(...incompleteRounds);
	}
}

// Global singleton
export const Bracket = new BracketManager();

