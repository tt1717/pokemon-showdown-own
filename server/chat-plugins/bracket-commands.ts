/**
 * Bracket Tournament Admin Commands
 * Commands for managing single-elimination bracket tournaments
 */

import {Bracket} from '../bracket-manager';
import {Utils} from '../../lib';

export const commands: Chat.ChatCommands = {
	bracket: 'brackethelp',
	brackethelp(target, room, user) {
		if (!this.runBroadcast()) return;
		this.sendReplyBox(
			`<strong>📋 Bracket Tournament System</strong><br /><br />` +
			`Welcome to the bracket tournament! This is a <strong>single-elimination</strong> tournament where you play ladder battles against assigned opponents.<br /><br />` +
			
			`<strong>How It Works:</strong><br />` +
			`• Search for ladder battles as normal<br />` +
			`• You'll only match your bracket opponent<br />` +
			`• Play a best-of-N series until someone reaches the required wins<br />` +
			`• Tied battles don't count - keep playing until someone wins enough<br />` +
			`• Winners automatically advance to the next round<br />` +
			`• Battles are <strong>unrated</strong> (don't affect ladder ranking)<br /><br />` +
			
			`<strong>Commands You Can Use:</strong><br />` +
			`<code>/bracketstatus</code> - See the full tournament bracket with scores<br />` +
			`<code>/bracketmatch [player1], [player2]</code> - Check if two players should match<br />` +
			`<code>/brackethelp</code> - Show this help message<br /><br />` +
			
			`<strong>For Admins:</strong><br />` +
			`Type <code>/bracketadminhelp</code> to see tournament management commands`
		);
	},

	bracketadminhelp(target, room, user) {
		if (!this.runBroadcast()) return;
		this.sendReplyBox(
			`<strong>🛡️ Bracket Tournament - Admin Guide</strong><br /><br />` +
			
			`<strong>Server Setup:</strong><br />` +
			`Start server with: <code>node pokemon-showdown start --bracket-mode PORT</code><br />` +
			`This enables bracket matchmaking and disables IP checks for bots.<br /><br />` +
			
			`<strong>━━━ COMMAND REFERENCE ━━━</strong><br /><br />` +
			
			`<strong>/createbracket [format], [bestOf], [player1], [player2], ...</strong><br />` +
			`Creates a new single-elimination bracket tournament.<br />` +
			`• <strong>format</strong> - Battle format (gen1ou, gen9ou, gen9randombattle, etc.)<br />` +
			`• <strong>bestOf</strong> - Total games in series (first to floor(N/2)+1 wins)<br />` +
			`• <strong>players</strong> - Comma-separated list of usernames (must be power of 2)<br />` +
			`• Seeding: First player = seed 1 (strongest), last = lowest seed<br />` +
			`• Standard bracket pairings: 4-player (1v4, 2v3), 8-player (1v8, 4v5, 2v7, 3v6)<br />` +
			`Example: <code>/createbracket gen1ou, 20, Alice, Bob, Carol, Dave</code><br />` +
			`&nbsp;&nbsp;→ Best of 20 = first to 11 wins<br />` +
			`&nbsp;&nbsp;→ Round 1: Alice vs Dave, Bob vs Carol<br /><br />` +
			
			`<strong>/quickbracket</strong> (or with custom params)<br />` +
			`Creates bracket using default settings from <code>config/config.js</code><br />` +
			`Optional: <code>/quickbracket [format], [bestOf], [player1], ...</code> to override<br />` +
			`Useful when you have a standard tournament configuration saved<br /><br />` +
			
			`<strong>/shufflebracket [format], [bestOf], [player1], [player2], ...</strong><br />` +
			`Same as <code>/createbracket</code> but randomizes player seeding<br />` +
			`Use when you want random/fair seeding instead of ranking by skill<br />` +
			`Players are shuffled before bracket generation<br /><br />` +
			
			`<strong>/bracketstatus</strong><br />` +
			`Displays complete bracket with all rounds, matches, and current scores<br />` +
			`Shows: Active matches (with scores), completed matches (winners), waiting matches<br />` +
			`Anyone can use this command to check tournament progress<br /><br />` +
			
			`<strong>/resetbracket</strong><br />` +
			`⚠️ <strong>Deletes the entire bracket tournament and CSV file</strong><br />` +
			`Use when you need to start over from scratch<br />` +
			`Cannot be undone! Make sure this is what you want<br />` +
			`After reset, use <code>/createbracket</code> to start fresh<br /><br />` +
			
			`<strong>/bracketfreeze</strong><br />` +
			`⏸️ Pauses tournament progression<br />` +
			`• Current round matches can continue and finish<br />` +
			`• Winners will NOT advance to next round until resumed<br />` +
			`• Use this to control pacing between rounds<br />` +
			`• Example: Let Round 1 finish, then analyze before starting Round 2<br /><br />` +
			
			`<strong>/bracketresume</strong><br />` +
			`▶️ Resumes tournament progression after freeze<br />` +
			`• Automatically advances any winners that were waiting<br />` +
			`• Activates next round matches when both players ready<br />` +
			`• Tournament continues normally<br /><br />` +
			
			`<strong>/forcebracketwin [winner], [loser]</strong><br />` +
			`Manually records one battle win in a series<br />` +
			`<strong>Use cases:</strong><br />` +
			`• Player forfeits a single game<br />` +
			`• Battle result wasn't recorded due to crash/bug<br />` +
			`• Correcting an error in match scores<br />` +
			`<strong>Important:</strong> This records ONE win, not a whole match<br />` +
			`Players must be in an active match together<br />` +
			`Example: <code>/forcebracketwin Alice, Bob</code> gives Alice +1 win vs Bob<br />` +
			`Automatically shows updated <code>/bracketstatus</code> after recording<br /><br />` +
			
			`<strong>━━━ SERIES COMPLETION ━━━</strong><br /><br />` +
			
			`<strong>Match ends when a player reaches the required wins</strong><br />` +
			`• Best of 99 → first to 50 wins<br />` +
			`• Best of 20 → first to 11 wins<br />` +
			`• <strong>Tied battles don't count</strong> - match continues until someone wins<br />` +
			`• Example: 48-47 with 10 ties → match still active, need 50 total wins<br /><br />` +
			
			`<strong>━━━ CONFIGURATION ━━━</strong><br /><br />` +
			
			`<strong>config/config.js → exports.brackettournament:</strong><br />` +
			`• <code>format</code> - Default battle format<br />` +
			`• <code>bestOf</code> - Default series length (99 = first to 50 wins)<br />` +
			`• <code>participants</code> - Number of players (must be power of 2)<br />` +
			`• <code>playerList</code> - Array of default participant usernames<br />` +
			`• <code>rated: false</code> - Bracket battles don't affect ladder (recommended!)<br />` +
			`• <code>randomizeSeeding</code> - Shuffle players before bracket creation<br />` +
			`• <code>autoInit: false</code> - Wait for <code>/createbracket</code> (vs auto-start on boot)<br /><br />` +
			
			`<strong>━━━ TROUBLESHOOTING ━━━</strong><br /><br />` +
			
			`<strong>Players can't find each other:</strong> Check <code>/bracketstatus</code> - they must be matched opponents<br />` +
			`<strong>Same-IP matching fails:</strong> <code>--bracket-mode</code> enables <code>noipchecks</code> automatically<br />` +
			`<strong>Wins not recording:</strong> Check server logs for <code>[BRACKET]</code> messages<br />` +
			`<strong>Bracket stuck:</strong> Use <code>/forcebracketwin</code> to manually advance<br />` +
			`<strong>Wrong seeding:</strong> Players listed first = highest seeds (1, 2, 3...)<br /><br />` +
			
			`<strong>All Admin Commands:</strong><br />` +
			`<code>/createbracket</code>, <code>/quickbracket</code>, <code>/shufflebracket</code>,<br />` +
			`<code>/resetbracket</code>, <code>/bracketfreeze</code>, <code>/bracketresume</code>,<br />` +
			`<code>/forcebracketwin</code><br />` +
			`All require Administrator (~) rank.`
		);
	},

	createbracket(target, room, user) {
		this.checkCan('bypassall'); // Admin only
		
		if (!Config.bracketmode) {
			return this.errorReply('Bracket mode is not enabled. Start the server with --bracket-mode');
		}

		if (!target) return this.parse('/help createbracket');

		const parts = target.split(',').map(s => s.trim());
		if (parts.length < 4) {
			return this.errorReply(
				'Usage: /createbracket [format], [bestOf], [player1], [player2], ...\n' +
				'Example: /createbracket gen1ou, 99, PAC-Bot1, PAC-Bot2, PAC-Bot3, PAC-Bot4'
			);
		}

		const [format, bestOfStr, ...players] = parts;
		const bestOf = parseInt(bestOfStr);

		// Validate inputs
		if (!format) {
			return this.errorReply('Format is required');
		}
		if (isNaN(bestOf) || bestOf < 1 || bestOf > 999) {
			return this.errorReply('Best of must be a number between 1 and 999');
		}
		if (players.length < 2) {
			return this.errorReply('At least 2 players are required');
		}
		const numPlayers = players.length;
		if (numPlayers !== Math.pow(2, Math.floor(Math.log2(numPlayers)))) {
			return this.errorReply(
				`Number of players must be a power of 2 (2, 4, 8, 16, 32, etc.). ` +
				`You provided ${numPlayers} players.`
			);
		}

		// Validate player names
		const invalidPlayers = players.filter(p => !p || toID(p).length === 0);
		if (invalidPlayers.length > 0) {
			return this.errorReply('All player names must be valid');
		}

		// Check for duplicates
		const uniquePlayers = new Set(players.map(p => toID(p)));
		if (uniquePlayers.size !== players.length) {
			return this.errorReply('Duplicate players detected. Each player must be unique.');
		}

		// Initialize bracket
		void Bracket.initialize(format, players, bestOf, false).then(() => {
			this.addModAction(`${user.name} created a ${numPlayers}-player bracket tournament for ${format}, best of ${bestOf}`);
			this.modlog('BRACKET CREATE', null, `${format}, ${numPlayers} players, bo${bestOf}`);
			
			const status = Bracket.getStatus();
			this.sendReply('Bracket created successfully!');
			this.parse('/bracketstatus');
		}).catch((err: Error) => {
			this.errorReply(`Failed to create bracket: ${err.message}`);
		});
	},
	createbrackethelp: [
		`/createbracket [format], [bestOf], [player1], [player2], ... - Create a new bracket tournament. Requires: ~`,
		`Players are seeded in the order provided. Number of players must be a power of 2.`,
		`Example: /createbracket gen1ou, 99, PAC-Bot1, PAC-Bot2, PAC-Bot3, PAC-Bot4, PAC-Bot5, PAC-Bot6, PAC-Bot7, PAC-Bot8`,
	],

	quickbracket(target, room, user) {
		this.checkCan('bypassall'); // Admin only
		
		if (!Config.bracketmode) {
			return this.errorReply('Bracket mode is not enabled. Start the server with --bracket-mode');
		}

		if (!target) {
			// Use config defaults
			const config = Config.brackettournament;
			target = `${config.format}, ${config.bestOf}, ${config.playerList.join(', ')}`;
		}

		this.parse(`/createbracket ${target}`);
	},
	quickbrackethelp: [
		`/quickbracket - Create bracket using config/config.js settings. Requires: ~`,
		`/quickbracket [format], [bestOf], [players...] - Create bracket with custom settings`,
	],

	shufflebracket: 'createbracketshuffle',
	createbracketshuffle(target, room, user) {
		this.checkCan('bypassall'); // Admin only
		
		if (!Config.bracketmode) {
			return this.errorReply('Bracket mode is not enabled. Start the server with --bracket-mode');
		}

		if (!target) return this.parse('/help createbracketshuffle');

		const parts = target.split(',').map(s => s.trim());
		if (parts.length < 4) {
			return this.errorReply(
				'Usage: /shufflebracket [format], [bestOf], [player1], [player2], ...\n' +
				'Players will be randomly seeded.'
			);
		}

		const [format, bestOfStr, ...players] = parts;
		const bestOf = parseInt(bestOfStr);

		// Validate (same as createbracket)
		if (!format) return this.errorReply('Format is required');
		if (isNaN(bestOf) || bestOf < 1 || bestOf > 999) {
			return this.errorReply('Best of must be a number between 1 and 999');
		}
		
		const numPlayers = players.length;
		if (numPlayers !== Math.pow(2, Math.floor(Math.log2(numPlayers)))) {
			return this.errorReply(
				`Number of players must be a power of 2. You provided ${numPlayers} players.`
			);
		}

		// Initialize with shuffle
		void Bracket.initialize(format, players, bestOf, true).then(() => {
			this.addModAction(`${user.name} created a ${numPlayers}-player bracket (SHUFFLED) for ${format}, best of ${bestOf}`);
			this.modlog('BRACKET CREATE', null, `${format}, ${numPlayers} players (shuffled), bo${bestOf}`);
			
			this.sendReply('Bracket created with random seeding!');
			this.parse('/bracketstatus');
		}).catch((err: Error) => {
			this.errorReply(`Failed to create bracket: ${err.message}`);
		});
	},
	createbracketshufflehelp: [
		`/shufflebracket [format], [bestOf], [player1], [player2], ... - Create bracket with random seeding. Requires: ~`,
		`Players are randomly shuffled before bracket creation.`,
	],

	bracketstatus(target, room, user) {
		if (!Config.bracketmode) {
			return this.errorReply('Bracket mode is not enabled');
		}

		const status = Bracket.getStatus();
		
		if (status.includes('not initialized')) {
			return this.errorReply('No bracket currently active. Use /createbracket to start one.');
		}

		// Format for HTML display
		const lines = status.split('\n');
		const html = lines.map(line => {
			if (line.startsWith('Round ')) {
				return `<strong>${Utils.escapeHTML(line)}</strong>`;
			} else if (line.includes('✓')) {
				return `<span style="color: green">${Utils.escapeHTML(line)}</span>`;
			} else if (line.includes('Match ')) {
				return `&nbsp;&nbsp;${Utils.escapeHTML(line)}`;
			}
			return Utils.escapeHTML(line);
		}).join('<br />');

		this.sendReplyBox(html);
	},
	bracketstatushelp: [`/bracketstatus - Show the current bracket tournament status`],

	resetbracket(target, room, user) {
		this.checkCan('bypassall'); // Admin only
		
		if (!Config.bracketmode) {
			return this.errorReply('Bracket mode is not enabled');
		}

		void Bracket.reset().then(() => {
			this.addModAction(`${user.name} reset the bracket tournament`);
			this.modlog('BRACKET RESET');
			this.sendReply('Bracket has been reset. Use /createbracket to start a new tournament.');
		});
	},
	resetbrackethelp: [
		`/resetbracket - Delete the current bracket and start over. Requires: ~`,
	],

	bracketmatch(target, room, user) {
		if (!Config.bracketmode) {
			return this.errorReply('Bracket mode is not enabled');
		}

		if (!target) return this.parse('/help bracketmatch');

		const [player1, player2] = target.split(',').map(s => toID(s.trim()));
		
		if (!player1 || !player2) {
			return this.errorReply('Usage: /bracketmatch [player1], [player2]');
		}

		const canMatch = Bracket.canMatch(player1, player2);
		
		if (canMatch) {
			this.sendReply(`✓ ${player1} and ${player2} are scheduled to play in the bracket`);
		} else {
			this.sendReply(`✗ ${player1} and ${player2} are not scheduled to play`);
		}
	},
	bracketmatchhelp: [
		`/bracketmatch [player1], [player2] - Check if two players should match in the bracket`,
	],

	bracketinfo: 'bracketplayers',
	bracketplayers(target, room, user) {
		if (!Config.bracketmode) {
			return this.errorReply('Bracket mode is not enabled');
		}

		const status = Bracket.getStatus();
		
		if (status.includes('not initialized')) {
			return this.errorReply('No bracket currently active');
		}

		// Extract active players who can search
		// This is a simplified version - you might want to add a getActivePlayers() method to BracketManager
		this.sendReply('Use /bracketstatus to see all matches and players');
	},

	forcebracketwin(target, room, user) {
		this.checkCan('bypassall'); // Admin only
		
		if (!Config.bracketmode) {
			return this.errorReply('Bracket mode is not enabled');
		}

		if (!Bracket.isInitialized()) {
			return this.errorReply('No bracket currently active. Use /createbracket to start a tournament first.');
		}

		if (!target) return this.parse('/help forcebracketwin');

		const [winnerName, loserName] = target.split(',').map(s => s.trim());
		
		if (!winnerName || !loserName) {
			return this.errorReply('Usage: /forcebracketwin [winner], [loser]');
		}

		const winner = toID(winnerName);
		const loser = toID(loserName);

		// Verify these players have an active match
		const opponent = Bracket.getOpponent(winner);
		if (!opponent) {
			return this.errorReply(`${winnerName} is not in an active match. Check /bracketstatus`);
		}
		if (opponent !== loser) {
			return this.errorReply(`${winnerName} should be playing ${opponent}, not ${loserName}. Check /bracketstatus`);
		}

		void Bracket.recordWin(winner, loser).then(() => {
			this.addModAction(`${user.name} manually recorded a bracket win: ${winner} beats ${loser}`);
			this.modlog('BRACKET FORCEWIN', null, `${winner} > ${loser}`);
			this.sendReply(`Recorded win for ${winner} in their match against ${loser}`);
			this.parse('/bracketstatus');
		});
	},
	forcebracketwinhelp: [
		`/forcebracketwin [winner], [loser] - Manually record a bracket match result. Requires: ~`,
		`Use this to fix errors or handle forfeits.`,
	],

	bracketfreeze(target, room, user) {
		this.checkCan('bypassall'); // Admin only
		
		if (!Config.bracketmode) {
			return this.errorReply('Bracket mode is not enabled');
		}

		void Bracket.freeze().then(() => {
			this.addModAction(`${user.name} froze the bracket tournament`);
			this.modlog('BRACKET FREEZE');
			this.sendReply('⏸️ Tournament FROZEN. Current round can finish, but winners will not advance until /bracketresume');
			this.parse('/bracketstatus');
		}).catch((err: Error) => {
			this.errorReply(`Failed to freeze bracket: ${err.message}`);
		});
	},
	bracketfreezehelp: [
		`/bracketfreeze - Freeze tournament progression. Current round can finish but no advancement. Requires: ~`,
	],

	bracketresume(target, room, user) {
		this.checkCan('bypassall'); // Admin only
		
		if (!Config.bracketmode) {
			return this.errorReply('Bracket mode is not enabled');
		}

		void Bracket.resume().then(() => {
			this.addModAction(`${user.name} resumed the bracket tournament`);
			this.modlog('BRACKET RESUME');
			this.sendReply('▶️ Tournament RESUMED. Winners will now advance to next round.');
			this.parse('/bracketstatus');
		}).catch((err: Error) => {
			this.errorReply(`Failed to resume bracket: ${err.message}`);
		});
	},
	bracketresumehelp: [
		`/bracketresume - Resume tournament progression after freeze. Advances waiting winners. Requires: ~`,
	],
};

