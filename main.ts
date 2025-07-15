import { ItemView, MarkdownView, Plugin, PluginSettingTab, requestUrl, Setting, WorkspaceLeaf, MarkdownRenderer } from 'obsidian'

const VIEW_TYPE_LLM_COMMENTARY = 'llm-commentary-view'

type LlmCommentarySettings = {
	claudeApiKey: string
	prompt: string
	model: string
}

const DEFAULT_SETTINGS: LlmCommentarySettings = {
	claudeApiKey: '',
	prompt: `You are Scott Alexander, the popular internet writer.  You are helping someone write an insightful blog post.  Your output should be a list of thoughts about content could be added to expand the post.

Do not comment on style or grammar issues, only provide ideas that could improve the post.

Do not suggest expanding on the current content of the post, come up with new ideas that would be a good direction to take the piece.

Do not give more than 3 suggestions.

Phrase the suggestions to be brief, eliminate any words in the suggestion that get in the way of the core idea.

Think about a bunch of different suggestions that would be great improvements to the post, and then pick the ones that are most concrete.

DO NOT give generic suggestions like "try giving a specific example..."

Do not say what you are doing, only provide the suggestions.

Do not use lists, respond in paragraphs.
`,
	model: 'claude-sonnet-4-20250514'
}

function assert(condition: any, message = 'Assertion failed'): asserts condition {
	if (!condition) {
		throw new Error(message)
	}
}

type ClaudeResponse = {
	id: string
	content: {
		type: 'text'
		text: string
	}[]
}

const waiting_response = 'It looks like the user is still in the middle of a thought.'

export default class LlmCommentaryPlugin extends Plugin {
	settings: LlmCommentarySettings
	private last_api_call_timestamp = 0

	async onload() {
		await this.loadSettings()

		this.addSettingTab(new LlmCommentarySettingTab(this.app, this))
		this.registerView(
			VIEW_TYPE_LLM_COMMENTARY,
			(leaf) => new LlmCommentaryView(leaf)
		)

		this.addRibbonIcon('pencil', 'Open LLM Commentary View', () => {
			this.getCommentary()
		})

		this.addCommand({
			id: 'open-llm-commentary-view',
			name: 'Open LLM Commentary View',
			callback: () => {
				this.getCommentary()
			}
		})

		// Listen for editor changes to automatically update commentary
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, view) => {
				if (view instanceof MarkdownView) {
					const now = Date.now()
					if (now - this.last_api_call_timestamp >= 5000) {
						this.last_api_call_timestamp = now
						this.getCommentary()
					}
				}
			})
		)
	}

	async onunload() {
		// Clean up any views when plugin is disabled
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}

	async activateView() {
		const { workspace } = this.app

		const leaves = workspace.getLeavesOfType(VIEW_TYPE_LLM_COMMENTARY)

		let leaf = leaves.length > 0 ? leaves[0] : null

		if (leaves.length === 0) {
			leaf = workspace.getRightLeaf(false)
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_LLM_COMMENTARY,
					active: true,
				})
			}
		}

		assert(leaf)
		assert(leaf.view instanceof LlmCommentaryView)

		workspace.revealLeaf(leaf)

		if (!this.settings.claudeApiKey) {
			leaf.view.display('No API key set. Please set one in the settings.')
		}

		return leaf.view
	}

	async getCommentary() {
		const view = await this.activateView()

		// Get the active markdown view to extract content
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView)
		if (!activeView) {
			view.display('No active markdown view found.')
			return
		}

		try {
			const response = await requestUrl({
				url: 'https://api.anthropic.com/v1/messages',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.settings.claudeApiKey,
					'anthropic-version': '2023-06-01'
				},
				body: JSON.stringify({
					model: this.settings.model,
					max_tokens: 1000,
					messages: [
						{
							role: 'user',
							content: activeView.editor.getValue()
						}
					],
					system: this.settings.prompt + `\n\nIf there are any unfinished sentences (sentences that do not have a period or other sentence-ending punctuation) anywhere in the text, respond with "${waiting_response}" and NOTHING ELSE.  Only the text "${waiting_response}"`
				})
			})

			const json = response.json as ClaudeResponse

			const claude_response = json.content[0].text

			if (claude_response !== waiting_response) {
				view.display(claude_response)
			}
		} catch (error: unknown) {
			assert(error instanceof Error)
			view.display(error.message)
		}
	}
}

class LlmCommentaryView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf)
	}

	getViewType() {
		return VIEW_TYPE_LLM_COMMENTARY
	}

	getDisplayText() {
		return 'LLM Commentary'
	}

	async onOpen() {
		this.containerEl.empty()
	}

	display(markdown: string) {	
		this.containerEl.empty()
		const wrapper = this.containerEl.createDiv({ cls: 'wrapper' })
		MarkdownRenderer.render(this.app, markdown, wrapper, '', this)
	}

	async onClose() {
		// Nothing to clean up
	}
}

class LlmCommentarySettingTab extends PluginSettingTab {
	plugin: LlmCommentaryPlugin

	constructor(app: any, plugin: LlmCommentaryPlugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	display(): void {
		const { containerEl } = this

		containerEl.empty()

		new Setting(containerEl)
			.setName('Claude API Key')
			.setDesc('You can get one from https://console.anthropic.com/settings/keys')
			.addText(text => text
				.setValue(this.plugin.settings.claudeApiKey)
				.onChange(async (value) => {
					this.plugin.settings.claudeApiKey = value
					await this.plugin.saveSettings()
				}))

		new Setting(containerEl)
			.setName('Prompt')
			.addTextArea(text => text
				.setValue(this.plugin.settings.prompt)
				.onChange(async (value) => {
					this.plugin.settings.prompt = value
					await this.plugin.saveSettings()
				})
			)

		new Setting(containerEl)
			.setName('Model')
			.setDesc('You can find a list of models at https://docs.anthropic.com/en/docs/about-claude/models/overview')
			.addText(text => text
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value
					await this.plugin.saveSettings()
				}))
	}
}
