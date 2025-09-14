import { Component, MarkdownPostProcessor, MarkdownRenderer, Plugin } from 'obsidian'
import { CaptionSettings, CaptionSettingTab, DEFAULT_SETTINGS } from './settings'

const filenamePlaceholder = '%'
const filenameExtensionPlaceholder = '%.%'

export default class ImageCaptions extends Plugin {
  settings: CaptionSettings
  observer: MutationObserver

  async onload () {
    this.registerMarkdownPostProcessor(
      this.externalImageProcessor()
    )

    await this.loadSettings()
    this.addSettingTab(new CaptionSettingTab(this.app, this))

    this.observer = new MutationObserver((mutations: MutationRecord[]) => {
      mutations.forEach((rec: MutationRecord) => {
        if (rec.type === 'childList') {
          const container = rec.target as Element;
          
          // Grouper les image-embed consécutifs AVANT de les traiter
          this.groupConsecutiveImageEmbeds(container);
          
          // Traiter normalement les image-embed restants
          container.querySelectorAll('.image-embed, .video-embed')
            .forEach(async imageEmbedContainer => {
              const img = imageEmbedContainer.querySelector('img, video')
              const width = imageEmbedContainer.getAttribute('width') || ''
              const parsedData = this.parseImageData(imageEmbedContainer)

              if (parsedData.caption) {
                imageEmbedContainer.setAttribute('alt', parsedData.caption);
              }

              if (!img) return
              const figure = imageEmbedContainer.querySelector('figure')
              const figCaption = imageEmbedContainer.querySelector('figcaption')
              if (figure || img.parentElement?.nodeName === 'FIGURE') {
                // Node has already been processed
                // Check if the text needs to be updated
                if (figCaption && parsedData.caption) {
                  // Update the text in the existing element
                  const children = await renderMarkdown(parsedData.caption, '', this) ?? [parsedData.caption]
                  figCaption.replaceChildren(...children)
                } else if (!parsedData.caption) {
                  // The alt-text has been removed, so remove the custom <figure> element
                  // and set it back to how it was originally with just the plain <img> element
                  imageEmbedContainer.appendChild(img)
                  figure?.remove()
                }
              } else {
                if (parsedData.caption && parsedData.caption !== imageEmbedContainer.getAttribute('src')) {
                  await this.insertFigureWithCaption(img as HTMLElement, imageEmbedContainer, parsedData, '')
                }
              }
              if (width) {
                // Update the image width, if specified
                img.setAttribute('width', width)
              } else {
                // It's critical to remove the empty width attribute, rather than setting it to ""
                img.removeAttribute('width')
              }
            })
        }
      })
    })
    this.observer.observe(document.body, {
      subtree: true,
      childList: true
    })
  }

  groupConsecutiveImageEmbeds(container: Element) {
    const imageEmbeds = Array.from(container.querySelectorAll('.image-embed'));
    
    if (imageEmbeds.length <= 1) return;
    
    let consecutiveGroups: Element[][] = [];
    let currentGroup: Element[] = [];
    
    for (let i = 0; i < imageEmbeds.length; i++) {
      const current = imageEmbeds[i];
      const next = imageEmbeds[i + 1];
      
      currentGroup.push(current);
      
      // Vérifier si l'élément suivant est consécutif (même parent, éléments adjacents)
      if (!next || !this.areConsecutive(current, next)) {
        if (currentGroup.length > 1) {
          consecutiveGroups.push(currentGroup);
        }
        currentGroup = [];
      }
    }
    
    // Créer des conteneurs groupés
    consecutiveGroups.forEach(group => {
      this.createGroupedContainer(group);
    });
  }

  areConsecutive(elem1: Element, elem2: Element): boolean {
    // Vérifier si les éléments ont le même parent
    if (elem1.parentElement !== elem2.parentElement) return false;
    
    // Vérifier si elem2 suit directement elem1 (ou avec seulement du whitespace entre)
    let nextSibling = elem1.nextElementSibling;
    while (nextSibling && nextSibling.nodeType === Node.TEXT_NODE && 
           (nextSibling.textContent || '').trim() === '') {
      nextSibling = nextSibling.nextElementSibling;
    }
    
    return nextSibling === elem2;
  }

  createGroupedContainer(group: Element[]) {
    const parent = group[0].parentElement;
    if (!parent) return;
    
    // Éviter de créer des groupes imbriqués
    if (parent.classList.contains('image-embed-group')) return;
    
    // Créer un conteneur pour le groupe
    const groupContainer = parent.createEl('div', { 
      cls: 'image-embed-group' 
    });
    
    // Insérer le conteneur à la place du premier élément
    parent.insertBefore(groupContainer, group[0]);
    
    // Déplacer tous les éléments du groupe dans le conteneur
    group.forEach(elem => {
      groupContainer.appendChild(elem);
    });
    
    // Optionnel: ajouter des classes CSS pour la mise en forme
    groupContainer.addClass('figure-grid'); // ou toute autre classe de votre choix
  }

  /**
   * Parse image data from alt attribute
   */
  parseImageData(img: HTMLElement | Element) {
    let altText = img.getAttribute('alt') || ''
    const src = img.getAttribute('src') || ''
    
    // Check if it's the default Obsidian behavior
    const edge = altText.replace(/ > /, '#')
    if (altText === src || edge === src) {
      return { caption: '', dataNom: 'image', id: this.generateSlug(src) }
    }

    // Split by pipe
    const parts = altText.split('|').map(part => part.trim())
    
    const result = {
      dataNom: 'image',
      caption: '',
      width: undefined as string | undefined,
      printwidth: undefined as string | undefined,
      col: undefined as string | undefined,
      printcol: undefined as string | undefined,
      class: [] as string[],
      poster: undefined as string | undefined,
      imgX: undefined as string | undefined,
      imgY: undefined as string | undefined,
      imgW: undefined as string | undefined,
      id: this.generateSlug(src)
    }

    // New syntax: first part is data-nom
    if (parts.length > 1 && ['imagenote', 'image', 'imageGrid', 'figure', 'video'].includes(parts[0])) {
      result.dataNom = parts[0]
      
      // Parse remaining parts as key:value
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i]
        
        if (part.includes(':')) {
          const [key, ...valueParts] = part.split(':')
          const value = valueParts.join(':').trim()
          
          switch (key.toLowerCase()) {
            case 'caption': result.caption = value; break
            case 'width': result.width = value; break
            case 'printwidth': result.printwidth = value; break
            case 'col': result.col = value; break
            case 'printcol': result.printcol = value; break
            case 'class': result.class = value.split(',').map(c => c.trim()); break
            case 'poster': result.poster = value; break
            case 'imgx': result.imgX = value; break
            case 'imgy': result.imgY = value; break
            case 'imgw': result.imgW = value; break
            case 'id': result.id = value; break
          }
        }
      }
    } else {
      // Old syntax: first part is caption
      result.caption = parts[0]
    }

    // Apply existing logic
    if (this.settings.captionRegex && result.caption) {
      try {
        const match = result.caption.match(new RegExp(this.settings.captionRegex))
        result.caption = match?.[1] || ''
      } catch (e) {}
    }

    if (result.caption === filenamePlaceholder) {
      const match = src.match(/[^\\/]+(?=\.\w+$)|[^\\/]+$/)
      result.caption = match?.[0] || ''
    } else if (result.caption === filenameExtensionPlaceholder) {
      const match = src.match(/[^\\/]+$/)
      result.caption = match?.[0] || ''
    } else if (result.caption === '\\' + filenamePlaceholder) {
      result.caption = filenamePlaceholder
    }

    result.caption = result.caption.replace(/<<(.*?)>>/g, (_, linktext) => '[[' + linktext + ']]')

    return result
  }

  /**
   * Generate a slug from image src
   */
  generateSlug(src: string): string {
    const filename = src.split('/').pop() || src
    const nameWithoutExt = filename.replace(/\.[^.]+$/, '')
    return nameWithoutExt
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }

  /**
   * Process an HTMLElement or Element to extract the caption text
   * from the alt attribute.
   *
   * Optionally use the image filename if the filenamePlaceholder is specified.
   *
   * @param img
   */
  getCaptionText (img: HTMLElement | Element) {
    const parsedData = this.parseImageData(img)
    return parsedData.caption
  }

  /**
   * External images can be processed with a Markdown Post Processor, but only in Reading View.
   */
  externalImageProcessor (): MarkdownPostProcessor {
    return (el, ctx) => {
      el.findAll('img:not(.emoji), video')
        .forEach(async img => {
          const parsedData = this.parseImageData(img)
          const parent = img.parentElement
          if (parent && parent?.nodeName !== 'FIGURE' && parsedData.caption && parsedData.caption !== img.getAttribute('src')) {
            await this.insertFigureWithCaption(img, parent, parsedData, ctx.sourcePath)
          }
        })
    }
  }

  /**
   * Replace the original <img> element with appropriate structure
   */
  async insertFigureWithCaption (imageEl: HTMLElement, outerEl: HTMLElement | Element, parsedData: any, sourcePath: string) {
    let container: HTMLElement

    if (parsedData.caption) {
      imageEl.setAttribute('alt', parsedData.caption);
    } else {
      imageEl.removeAttribute('alt');
    }

    if (parsedData.dataNom === 'imagenote') {
      // Special structure for imagenote
      container = outerEl.createEl('span')
      container.addClass('imagenote')
      container.setAttribute('id', parsedData.id)
      container.setAttribute('data-src', imageEl.getAttribute('src') || '')
      
      // Add custom classes
      if (parsedData.class && parsedData.class.length > 0) {
        parsedData.class.forEach((cls: string) => container.addClass(cls))
      }
      
      container.appendChild(imageEl)
      
      if (parsedData.caption) {
        const captionSpan = container.createEl('span', { cls: 'caption' })
        const children = await renderMarkdown(parsedData.caption, sourcePath, this) ?? [parsedData.caption]
        captionSpan.replaceChildren(...children)
      }
    } else if (parsedData.dataNom === 'video') {
      // Special structure for video
      container = outerEl.createEl('figure')
      container.addClass('videofigure')
      container.setAttribute('data-src', imageEl.getAttribute('src') || '')
      
      // Add custom classes and styles
      if (parsedData.class && parsedData.class.length > 0) {
        parsedData.class.forEach((cls: string) => container.addClass(cls))
      }
      
      const style: string[] = []
      if (parsedData.width) style.push(`--width: ${parsedData.width}`)
      if (parsedData.printwidth) style.push(`--print-width: ${parsedData.printwidth}`)
      if (parsedData.col) style.push(`--col: ${parsedData.col}`)
      if (parsedData.printcol) style.push(`--print-col: ${parsedData.printcol}`)
      if (parsedData.imgX) style.push(`--img-x: ${parsedData.imgX}`)
      if (parsedData.imgY) style.push(`--img-y: ${parsedData.imgY}`)
      if (parsedData.imgW) style.push(`--img-w: ${parsedData.imgW}`)
      
      if (style.length > 0) {
        container.setAttribute('style', style.join('; '))
      }
      
      // Create video wrapper div
      const videoDiv = container.createEl('div', { cls: 'video' })
      if (parsedData.poster) {
        videoDiv.setAttribute('style', `background-image: url(${parsedData.poster})`)
      }
      
      // Handle video content (YouTube/Vimeo or regular video)
      const src = imageEl.getAttribute('src') || ''
      const videoContent = this.createVideoContent(src)
      if (videoContent) {
        videoDiv.innerHTML = videoContent
      } else {
        videoDiv.appendChild(imageEl)
      }
      
      if (parsedData.caption) {
        const children = await renderMarkdown(parsedData.caption, sourcePath, this) ?? [parsedData.caption]
        container.createEl('figcaption', {
          cls: 'figcaption'
        }).replaceChildren(...children)
      }
    } else {
      // Standard figure structure for other types
      container = outerEl.createEl('figure')
      container.addClass('figure')
      container.setAttribute('data-nom', parsedData.dataNom)
      container.setAttribute('id', parsedData.id)
      
      // Add custom classes
      if (parsedData.class && parsedData.class.length > 0) {
        parsedData.class.forEach((cls: string) => container.addClass(cls))
      }
      
      // Set CSS custom properties
      const style: string[] = []
      if (parsedData.width) style.push(`--width: ${parsedData.width}`)
      if (parsedData.printwidth) style.push(`--print-width: ${parsedData.printwidth}`)
      if (parsedData.col) style.push(`--col: ${parsedData.col}`)
      if (parsedData.printcol) style.push(`--print-col: ${parsedData.printcol}`)
      if (parsedData.imgX) style.push(`--img-x: ${parsedData.imgX}`)
      if (parsedData.imgY) style.push(`--img-y: ${parsedData.imgY}`)
      if (parsedData.imgW) style.push(`--img-w: ${parsedData.imgW}`)
      
      if (style.length > 0) {
        container.setAttribute('style', style.join('; '))
      }
      
      // Add poster attribute for videos
      if (parsedData.poster && imageEl.tagName.toLowerCase() === 'video') {
        imageEl.setAttribute('poster', parsedData.poster)
      }
      
      container.appendChild(imageEl)
      
      if (parsedData.caption) {
        const children = await renderMarkdown(parsedData.caption, sourcePath, this) ?? [parsedData.caption]
        container.createEl('figcaption', {
          cls: 'figcaption'
        }).replaceChildren(...children)
      }
    }
  }

  /**
   * Create video content for YouTube/Vimeo URLs
   */
  createVideoContent(url: string): string | null {
    if (url.includes('yout')) {
      return this.createYouTubeEmbed(url)
    }
    if (url.includes('vimeo')) {
      return this.createVimeoEmbed(url)
    }
    return null
  }

  createYouTubeEmbed(url: string): string | null {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/)
    if (!match) return null
    
    const videoId = match[1]
    const src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`
    
    return `<youtube-embed><iframe scrolling='no' width='640' height='360' allow='autoplay; fullscreen' src='' data-src='${src}'></iframe><button aria-label='Play video'></button></youtube-embed>`
  }

  createVimeoEmbed(url: string): string | null {
    const match = url.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)([0-9]+)/)
    if (!match) return null
    
    const videoId = match[1]
    const src = `https://player.vimeo.com/video/${videoId}?autoplay=1&rel=0`
    
    return `<vimeo-embed><iframe scrolling='no' width='640' height='360' allow='autoplay; fullscreen' src='' data-src='${src}'></iframe><button aria-label='Play video'></button></vimeo-embed>`
  }

  async loadSettings () {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings () {
    await this.saveData(this.settings)
  }

  onunload () {
    this.observer.disconnect()
  }
}

/**
 * Easy-to-use version of MarkdownRenderer.renderMarkdown. Returns only the child nodes, rather than a container block.
 * @param markdown
 * @param sourcePath
 * @param component - Typically you can just pass the plugin instance, but Liam from the Obsidian team says
 *   it's not a good practice (https://github.com/obsidianmd/obsidian-releases/pull/2263#issuecomment-1711864829).
 *   I'm currently struggling to find a proper way to do it.
 */
export async function renderMarkdown (markdown: string, sourcePath: string, component: Component): Promise<NodeList | undefined> {
  const el = createDiv()
  await MarkdownRenderer.renderMarkdown(markdown, el, sourcePath, component)
  for (const child of el.children) {
    if (child.tagName.toLowerCase() === 'p') {
      return child.childNodes
    }
  }
}