/**
 * Bot Login Filter
 * Prevents bot accounts (with PAC- prefix) from logging in without authentication.
 * This ensures bots can only be controlled programmatically with proper credentials.
 */

const BOT_PREFIX = 'pac';
const CONNECTION_GRACE_PERIOD = 10000; // 10 seconds

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

		// Check 2: Block multiple simultaneous connections (with grace period)
		// Bots should only have one connection; multiple connections suggest hijacking
		// We use a delayed check to handle legitimate reconnection scenarios where
		// the new connection is added before the old connection is cleaned up
		if (connectionCount > 1) {
			Monitor.log(
				`[BOT-FILTER] WARNING: ${user.name} has ${connectionCount} connections, ` +
				`checking again after ${CONNECTION_GRACE_PERIOD / 1000}s grace period`
			);

			// Don't block immediately - allow time for old connections to be cleaned up
			setTimeout(() => {
				// Re-check after grace period
				const currentConnectionCount = user.connections.length;
				
				if (currentConnectionCount > 1) {
					Monitor.log(
						`[BOT-FILTER] BLOCKING ${user.name} - still ${currentConnectionCount} ` +
						`connections after grace period (started with ${connectionCount})`
					);
					user.send(
						`|popup|Bot accounts can only have one active connection at a time. ` +
						`Multiple connections detected (${currentConnectionCount}). If you believe this is an error, ` +
						`please disconnect all connections and try again.`
					);
					user.disconnectAll();
				} else {
					Monitor.log(
						`[BOT-FILTER] ${user.name} connections normalized: ${connectionCount} → ${currentConnectionCount} ` +
						`(grace period allowed reconnection to complete)`
					);
				}
			}, CONNECTION_GRACE_PERIOD);

			// Don't block on initial detection - let the grace period handle it
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

