/**
 * Bot Login Filter
 * Prevents bot accounts (with PAC- prefix) from logging in without authentication.
 * This ensures bots can only be controlled programmatically with proper credentials.
 */

import {toID} from '../../sim/dex';

const BOT_PREFIX = 'pac';

export const loginfilter: Chat.LoginFilter = (user, oldUser, userType) => {
	try {
		const userid = toID(user.name);
		
		// Check if this is a bot account (starts with PAC-)
		if (!userid.startsWith(BOT_PREFIX)) return;
		
		// userType values:
		//   1: unregistered user (no authentication)
		//   2: registered user (authenticated)
		//   3: Pokemon Showdown system operator
		//   4: autoconfirmed
		//   5: permalocked
		//   6: permabanned
		
		const isAuthenticated = userType !== '1';
		const connectionCount = user.connections.length;
		
		Monitor.log(`[BOT-FILTER] Login for ${user.name}, userType: ${userType}, authenticated: ${isAuthenticated}, connections: ${connectionCount}`);
		
		// Check 1: Require authentication
		if (!isAuthenticated) {
			Monitor.log(`[BOT-FILTER] BLOCKING unauthenticated login for ${user.name}`);
			user.send(
				`|popup|Bot accounts (${user.name}) require authentication. ` +
				`This account is registered and cannot be accessed without a password. ` +
				`Please use a programmatic client like poke-env with proper credentials.`
			);
			user.disconnectAll();
			return;
		}
		
		// Check 2: Block multiple simultaneous connections
		// Bots should only have one connection; multiple connections suggest hijacking
		// Allow a small grace period for reconnections (connectionCount includes current connection)
		if (connectionCount > 1) {
			Monitor.log(`[BOT-FILTER] BLOCKING ${user.name} - multiple connections detected (${connectionCount})`);
			user.send(
				`|popup|Bot accounts can only have one active connection at a time. ` +
				`Multiple connections detected (${connectionCount}). If you believe this is an error, ` +
				`please disconnect all connections and try again.`
			);
			user.disconnectAll();
			return;
		}
		
		// Log successful authenticated bot login
		Monitor.log(`[BOT-FILTER] ALLOWED authenticated bot ${user.name} (single connection)`);
	} catch (error) {
		// Don't let filter errors break login entirely
		Monitor.error(`[BOT-FILTER] ERROR: ${error}`);
		// Allow login to proceed if filter fails (fail-open for safety)
	}
};

