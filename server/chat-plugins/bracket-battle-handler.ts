/**
 * Bracket Battle Handler
 * Hooks into battle end events to record wins for bracket tournament
 */

import {Bracket} from '../bracket-manager';
import type {RoomBattle} from '../room-battle';

export const handlers: Chat.Handlers = {
	onBattleEnd(battle: RoomBattle, winnerid: ID, playerids: ID[]) {
		// Only process if bracket mode is active
		if (!Config.bracketmode || !Bracket.isInitialized()) return;

		// Verify this is a 1v1 battle
		if (playerids.length !== 2) return;

		const [p1id, p2id] = playerids;
		
		// Check if both players are in a bracket match
		const p1opponent = Bracket.getOpponent(p1id);
		const p2opponent = Bracket.getOpponent(p2id);
		
		// Both players must be each other's opponents
		if (p1opponent !== p2id || p2opponent !== p1id) {
			// Not a bracket match, ignore
			return;
		}

		// Determine winner and loser
		let winner: ID;
		let loser: ID;

		if (winnerid === p1id) {
			winner = p1id;
			loser = p2id;
		} else if (winnerid === p2id) {
			winner = p2id;
			loser = p1id;
		} else {
			// Tie or error - don't record
			Monitor.warn(`[BRACKET] Battle ${battle.roomid} ended without clear winner: ${winnerid}`);
			return;
		}

		// Record the win (this is async but we don't await to avoid blocking battle end)
		void Bracket.recordWin(winner, loser).catch(err => {
			Monitor.error(`[BRACKET] Failed to record win for ${winner} vs ${loser}: ${err}`);
		});

		Monitor.log(`[BRACKET] Battle ${battle.roomid} recorded: ${winner} defeats ${loser}`);
	},
};

