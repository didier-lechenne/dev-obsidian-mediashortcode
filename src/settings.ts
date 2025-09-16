import { App, PluginSettingTab, Setting } from 'obsidian'
import ImageCaptions from './main'

export interface MediaType {
  name: string;
  template: string;
  extensions: string[];
}

export interface CaptionSettings {
  captionRegex: string;
  mediaTypes: Record<string, MediaType>;
}

export const DEFAULT_MEDIA_TYPES: Record<string, MediaType> = {
  image: {
    name: 'Image',
    template: '<figure data-grid="image" class="figure {type} {classes}" id="{id}" data-src="{src}">{media}<figcaption class="figcaption">{caption}</figcaption></figure>',
    extensions: []
  },
  imagenote: {
    name: 'Image Note',
    template: '<span class="{type} {classes}" id="{id}" data-src="{src}">{media}<span class="figcaption">{caption}</span></span>',
    extensions: []
  },
  video: {
    name: 'Video',
    template: '<span class="{type} {classes}" id="{id}" data-src="{src}">{media}<span class="figcaption">{caption}</span></span>',
    extensions: ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.mkv']
  },
  audio: {
    name: 'Audio',
    template: '<div class="{type} {classes}" id="{id}" data-src="{src}">{media}<div class="figcaption">{caption}</div></div>',
    extensions: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a']
  },
  pdf: {
    name: 'PDF Document',
    template: '<div class="{type} {classes}" id="{id}" data-src="{src}">{media}<div class="figcaption">{caption}</div></div>',
    extensions: ['.pdf']
  },
  figure: {
    name: 'Figure',
    template: '<figure data-grid="image" class="{type} {classes}">{media}<figcaption class="figcaption">{caption}</figcaption></figure>',
    extensions: []
  },
  grid: {
    name: 'Grid',
    template: '<figure data-grid="image" class="figure {type} {classes}">{media}</figure><figcaption class="figcaption">{caption}</figcaption>',
    extensions: []
  }
}

export const DEFAULT_SETTINGS: CaptionSettings = {
  captionRegex: '',
  mediaTypes: DEFAULT_MEDIA_TYPES
}

export class CaptionSettingTab extends PluginSettingTab {
  plugin: ImageCaptions

  constructor (app: App, plugin: ImageCaptions) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this

    containerEl.empty()

    new Setting(containerEl)
      .setName('Media Shortcode Settings')
      .setHeading()

    // Caption regex
    new Setting(containerEl)
      .setName('Caption regex')
      .setDesc('For advanced caption parsing, you can add a regex here. The first capturing group will be used as the image caption.')
      .addText(text => text
        .setPlaceholder('^([^|]+)')
        .setValue(this.plugin.settings.captionRegex)
        .onChange(async value => {
          this.plugin.settings.captionRegex = value
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Media Types & Templates')
      .setHeading()

    // Templates pour chaque type de média
    Object.entries(this.plugin.settings.mediaTypes).forEach(([type, config]) => {
      new Setting(containerEl)
        .setName(`${config.name} Template`)
        .setDesc(`HTML template for ${type}. Available variables: {type}, {classes}, {id}, {src}, {media}, {caption}`)
        .addTextArea(text => {
          text.setValue(config.template)
          text.inputEl.style.height = '100px'
          text.inputEl.style.fontFamily = 'monospace'
          text.onChange(async value => {
            this.plugin.settings.mediaTypes[type].template = value
            await this.plugin.saveSettings()
          })
        })

      new Setting(containerEl)
        .setName(`${config.name} Extensions`)
        .setDesc(`File extensions for auto-detection (comma separated)`)
        .addText(text => text
          .setValue(config.extensions.join(', '))
          .onChange(async value => {
            this.plugin.settings.mediaTypes[type].extensions = 
              value.split(',').map(ext => ext.trim()).filter(ext => ext.length > 0)
            await this.plugin.saveSettings()
          }))
    })

    // Reset templates
    new Setting(containerEl)
      .setName('Reset Templates')
      .setDesc('Reset all templates to default values')
      .addButton(button => button
        .setButtonText('Reset to Defaults')
        .onClick(async () => {
          this.plugin.settings.mediaTypes = { ...DEFAULT_MEDIA_TYPES }
          await this.plugin.saveSettings()
          this.display() // Refresh display
        }))
  }
}