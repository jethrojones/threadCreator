import {
	App,
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting
} from 'obsidian';

/**
 * Interface to define the plugin settings.
 */
interface TwitterThreadPluginSettings {
	/** Maximum number of characters per tweet. */
	maxTweetLength: number;
}

/**
 * Default settings for the plugin.
 */
const DEFAULT_SETTINGS: TwitterThreadPluginSettings = {
	maxTweetLength: 250,
};

/**
 * Main plugin class that extends Obsidian's Plugin base class.
 */
export default class TwitterThreadPlugin extends Plugin {
	settings: TwitterThreadPluginSettings;

	/**
	 * Called when the plugin is loaded.
	 */
	async onload() {
		// Load plugin settings.
		await this.loadSettings();

		// Register a command to convert the current note/selection into a Twitter thread.
		this.addCommand({
			id: 'create-twitter-thread',
			name: 'Convert note to Twitter thread',
			checkCallback: (checking: boolean) => {
				const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (mdView) {
					if (checking) {
						return true;
					}

					const editor = mdView.editor;
					// Get selected text; if empty, get the entire note.
					let content = editor.getSelection();
					if (!content) {
						content = editor.getValue();
					}

					// Clean the content: remove YAML front matter and markdown formatting.
					content = this.cleanContent(content);

					// Create tweets using the cleaned content.
					const tweets = this.createTweets(content, this.settings.maxTweetLength);
					this.createNewNote(tweets);
				}
				return false;
			}
		});

		// Add a ribbon icon to the left sidebar.
		const ribbonIconEl = this.addRibbonIcon('twitter', 'Twitter Thread Plugin', (evt: MouseEvent) => {
			new Notice('Twitter Thread Plugin activated!');
		});
		ribbonIconEl.addClass('twitter-thread-ribbon-class');

		// Add a status bar item to the bottom.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Twitter Thread Plugin');

		// Add settings tab.
		this.addSettingTab(new TwitterThreadSettingTab(this.app, this));
	}

	/**
	 * Called when the plugin is unloaded.
	 */
	onunload() {
		console.log('Twitter Thread Plugin unloaded');
	}

	/**
	 * Cleans the content by removing YAML front matter and markdown formatting.
	 *
	 * @param content - The raw text content.
	 * @returns The cleaned content.
	 */
	cleanContent(content: string): string {
		// Remove YAML front matter (if present at the beginning of the content).
		content = content.replace(/^---[\s\S]+?---\s*/, '');

		// Remove headings (remove one or more '#' characters at the start of a line).
		content = content.replace(/^#+\s+/gm, '');

		// Remove bold formatting (** or __).
		content = content.replace(/(\*\*|__)(.*?)\1/g, '$2');

		// Remove italic formatting (* or _).
		content = content.replace(/(\*|_)(.*?)\1/g, '$2');

		// Remove inline code formatting (backticks).
		content = content.replace(/`([^`]+)`/g, '$1');

		// Remove strikethrough formatting.
		content = content.replace(/~~(.*?)~~/g, '$1');

		// Convert Markdown links [text](url) to just text.
		content = content.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

		return content;
	}

	/**
 * Splits the provided text into an array of tweets.
 * This version attempts to split at sentence boundaries (i.e. after punctuation like . ! or ?)
 * so that tweets are more likely to end with complete sentences.
 *
 * @param content - The cleaned text content.
 * @param maxLength - Maximum characters per tweet.
 * @returns An array of tweet strings.
 */
createTweets(content: string, maxLength: number): string[] {
	// Split the content into words.
	const words = content.split(/\s+/);
	const tweets: string[] = [];
	// currentWords will hold the words for the current tweet.
	let currentWords: string[] = [];
	// lastSentenceBreak holds the index in currentWords of the last word that ended with . ! or ?
	let lastSentenceBreak = -1;

	// Helper to rebuild the tweet from currentWords.
	const buildTweet = (wordsArray: string[]) => wordsArray.join(" ");

	// Process each word.
	words.forEach((word) => {
		// Proposed new tweet if we add the current word.
		const candidateWords = [...currentWords, word];
		const candidateTweet = candidateWords.join(" ");

		// If candidate fits in the tweet.
		if (candidateTweet.length <= maxLength) {
			currentWords.push(word);
			// If the word ends with a sentence terminator, record its index.
			if (/[.!?]$/.test(word)) {
				lastSentenceBreak = currentWords.length - 1;
			}
		} else {
			// The candidate exceeds maxLength.
			if (lastSentenceBreak !== -1) {
				// If we have a sentence break, cut the tweet at that point.
				const tweet = buildTweet(currentWords.slice(0, lastSentenceBreak + 1));
				tweets.push(tweet.trim());
				// Prepare the next tweet with the remaining words (if any)
				// that come after the sentence break.
				currentWords = currentWords.slice(lastSentenceBreak + 1);
			} else {
				// If no sentence break exists, push the current tweet as is.
				if (currentWords.length > 0) {
					tweets.push(buildTweet(currentWords).trim());
					currentWords = [];
				}
			}

			// Reset lastSentenceBreak.
			lastSentenceBreak = -1;
			// Now, try adding the word to the new tweet.
			// If the word itself is too long, break it up.
			if (word.length > maxLength) {
				const parts = this.splitLongWord(word, maxLength);
				parts.forEach((part, idx) => {
					// If it's the first part, try to merge with existing words.
					if (idx === 0 && currentWords.length > 0) {
						const candidate = buildTweet([...currentWords, part]);
						if (candidate.length <= maxLength) {
							currentWords.push(part);
							if (/[.!?]$/.test(part)) {
								lastSentenceBreak = currentWords.length - 1;
							}
							return;
						}
					}
					// Otherwise, flush currentWords if any, and add this part as its own tweet.
					if (currentWords.length > 0) {
						tweets.push(buildTweet(currentWords).trim());
						currentWords = [];
					}
					tweets.push(part);
				});
			} else {
				// If word is within limits, start a new tweet with it.
				currentWords.push(word);
				if (/[.!?]$/.test(word)) {
					lastSentenceBreak = currentWords.length - 1;
				}
			}
		}
	});

	// After processing all words, if anything remains, add it as the final tweet.
	if (currentWords.length > 0) {
		tweets.push(buildTweet(currentWords).trim());
	}

	return tweets;
}

	/**
	 * Splits a long word into parts that do not exceed maxLength.
	 *
	 * @param word - The word to split.
	 * @param maxLength - Maximum allowed length per part.
	 * @returns An array of string parts.
	 */
	splitLongWord(word: string, maxLength: number): string[] {
		const parts: string[] = [];
		let start = 0;
		while (start < word.length) {
			parts.push(word.slice(start, start + maxLength));
			start += maxLength;
		}
		return parts;
	}

/**
 * Sanitizes a filename by removing illegal characters.
 * @param name The original filename.
 * @returns A sanitized filename.
 */
sanitizeFileName(name: string): string {
	return name.replace(/[\\\/:*?"<>|]/g, '');
}

	/**
 * Creates a new note containing the generated Twitter thread.
 *
 * @param tweets - Array of tweet strings.
 */
async createNewNote(tweets: string[]) {
	// Format the thread content and include the character count for each tweet.
	const threadContent = tweets
		.map((tweet, index) => `**Tweet ${index + 1} of ${tweets.length}: ${tweet.length} Characters**\n${tweet}`)
		.join('\n\n---\n\n');

	// Get today's date in YYYY-MM-DD format.
	const today = new Date();
	const dateStr = today.toISOString().split('T')[0];

	// Retrieve the original file's name (if available) and sanitize it.
	let originalFileName = 'Unknown File';
	const activeFile = this.app.workspace.getActiveFile();
	if (activeFile) {
		originalFileName = this.sanitizeFileName(activeFile.basename);
	}

	// Define base filename and folder.
	const folderName = 'TwitterThreads';
	const fileBase = `Twitter Thread ${dateStr} for ${originalFileName}`;
	const fileExt = '.md';
	let fileName = fileBase + fileExt;

	// Ensure the folder exists.
	try {
		await this.app.vault.createFolder(folderName);
	} catch (error) {
		// Folder probably exists, so ignore the error.
	}

	// Check for filename conflicts and append a counter if needed.
	let filePath = `${folderName}/${fileName}`;
	let counter = 1;
	while (this.app.vault.getAbstractFileByPath(filePath)) {
		fileName = `${fileBase} (${counter})${fileExt}`;
		filePath = `${folderName}/${fileName}`;
		counter++;
	}

	// Create the new note.
	await this.app.vault.create(filePath, threadContent);

	// Open the new note in the workspace.
	const createdFile = this.app.vault.getAbstractFileByPath(filePath);
	if (createdFile) {
		this.app.workspace.getLeaf(true).openFile(createdFile);
	}

	new Notice('Twitter thread created!');
}

/**
 * Sanitizes a filename by removing illegal characters.
 * @param name The original filename.
 * @returns A sanitized filename.
 */
sanitizeFileName(name: string): string {
	return name.replace(/[\\\/:*?"<>|]/g, '');
}

	/**
	 * Loads the plugin settings from disk.
	 */
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * Saves the current plugin settings to disk.
	 */
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/**
 * Plugin settings tab for configuring the Twitter Thread Plugin.
 */
class TwitterThreadSettingTab extends PluginSettingTab {
	plugin: TwitterThreadPlugin;

	constructor(app: App, plugin: TwitterThreadPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Renders the settings tab UI.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Maximum Tweet Length')
			.setDesc('Set the maximum number of characters per tweet (default is 250).')
			.addText(text =>
				text
					.setPlaceholder('250')
					.setValue(this.plugin.settings.maxTweetLength.toString())
					.onChange(async (value) => {
						const parsed = parseInt(value);
						if (!isNaN(parsed) && parsed > 0) {
							this.plugin.settings.maxTweetLength = parsed;
						} else {
							this.plugin.settings.maxTweetLength = DEFAULT_SETTINGS.maxTweetLength;
						}
						await this.plugin.saveSettings();
					})
			);
	}
}
