/**
 * Ladder Message Filter
 * Filters out the development message from ladder pages
 */

export const chatfilter: Chat.ChatFilter = function (message, user, room) {
	// Only filter messages that contain the specific ladder development text
	if (typeof message === 'string' && 
		(message.includes("btw if you couldn't tell the ladder screens aren't done yet") ||
		 message.includes("they'll look nicer than this once I'm done"))) {
		
		// Remove the specific message while preserving other content
		let filteredMessage = message
			.replace(/\(btw if you couldn't tell the ladder screens aren't done yet[^)]*\)/gi, '')
			.replace(/btw if you couldn't tell the ladder screens aren't done yet[^.]*\./gi, '')
			.replace(/they'll look nicer than this once I'm done[^.]*\./gi, '')
			.trim();
		
		// If the entire message was just the development note, return empty
		if (!filteredMessage || filteredMessage === message) {
			return filteredMessage || undefined;
		}
		
		return filteredMessage;
	}
	
	return message;
};

// No commands needed for this filter
export const commands: Chat.ChatCommands = {};


