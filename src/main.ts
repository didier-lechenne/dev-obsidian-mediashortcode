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
          // Traiter les figure-grid-container
          (<Element>rec.target)
            .querySelectorAll('.figure-grid-container')
            .forEach(async container => {
              this.processGridContainer(container);
            });
          
          // Traiter les nouvelles images ajoutées directement
          (<Element>rec.target)
            .querySelectorAll('img:not(.emoji), video')
            .forEach(async img => {
              const parent = img.parentElement;
              if (parent && !parent.closest('.figure-grid-container') && !img.closest('figure')) {
                await this.processStandaloneImage(img as HTMLElement);
              }
            });
        }
      });
    });
    
    this.observer.observe(document.body, {
      subtree: true,
      childList: true
    });
  }

  async processGridContainer(container: Element) {
    const images = container.querySelectorAll('img:not(.emoji), video');
    
    images.forEach(async img => {
      const parsedData = this.parseImageData(img);
      
      // Si l'image n'est pas encore dans une figure, la traiter
      if (!img.closest('figure') && !img.closest('.imagenote')) {
        await this.createFigureInGrid(img as HTMLElement, parsedData);
      }
    });
  }

  async createFigureInGrid(imageEl: HTMLElement, parsedData: any) {
    const container = imageEl.parentElement;
    if (!container) return;

    let figure: HTMLElement;

    if (parsedData.dataNom === 'imagenote') {
      figure = container.createEl('span', { cls: 'imagenote' });
      figure.setAttribute('id', parsedData.id);
      figure.setAttribute('data-src', imageEl.getAttribute('src') || '');
      
      if (parsedData.class?.length > 0) {
        parsedData.class.forEach((cls: string) => figure.addClass(cls));
      }
      
      // Remplacer l'image par la figure
      container.replaceChild(figure, imageEl);
      figure.appendChild(imageEl);
      
      if (parsedData.caption) {
        const captionSpan = figure.createEl('span', { cls: 'caption' });
        const children = await renderMarkdown(parsedData.caption, '', this) ?? [parsedData.caption];
        captionSpan.replaceChildren(...children);
      }
    } else {
      figure = container.createEl('figure', { cls: 'figure' });
      figure.setAttribute('data-nom', parsedData.dataNom);
      figure.setAttribute('id', parsedData.id);
      
      // Ajouter les classes et styles CSS
      if (parsedData.class?.length > 0) {
        parsedData.class.forEach((cls: string) => figure.addClass(cls));
      }
      
      const style: string[] = [];
      if (parsedData.width) style.push(`--width: ${parsedData.width}`);
      if (parsedData.printwidth) style.push(`--print-width: ${parsedData.printwidth}`);
      if (parsedData.col) style.push(`--col: ${parsedData.col}`);
      if (parsedData.printcol) style.push(`--print-col: ${parsedData.printcol}`);
      if (parsedData.imgX) style.push(`--img-x: ${parsedData.imgX}`);
      if (parsedData.imgY) style.push(`--img-y: ${parsedData.imgY}`);
      if (parsedData.imgW) style.push(`--img-w: ${parsedData.imgW}`);
      
      if (style.length > 0) {
        figure.setAttribute('style', style.join('; '));
      }
      
      // Remplacer l'image par la figure
      container.replaceChild(figure, imageEl);
      figure.appendChild(imageEl);
      
      if (parsedData.caption) {
        const children = await renderMarkdown(parsedData.caption, '', this) ?? [parsedData.caption];
        figure.createEl('figcaption', { cls: 'figcaption' }).replaceChildren(...children);
      }
    }
  }

  externalImageProcessor(): MarkdownPostProcessor {
    return (el, ctx) => {
      // Créer des conteneurs grid pour les images multiples
      this.createGridContainers(el);
      
      // Traiter les images individuelles
      el.findAll('img:not(.emoji), video').forEach(async img => {
        if (!img.closest('.figure-grid-container')) {
          await this.processStandaloneImage(img);
        }
      });
    };
  }

  createGridContainers(container: Element) {
    // Traiter toutes les images, pas seulement dans les paragraphes
    const images = Array.from(container.querySelectorAll('img:not(.emoji), video'));
    
    // Grouper les images consécutives
    let currentGroup: HTMLElement[] = [];
    let allGroups: HTMLElement[][] = [];
    
    for (let i = 0; i < images.length; i++) {
      const img = images[i] as HTMLElement;
      const parsedData = this.parseImageData(img);
      
      // Ajouter à un groupe si l'image a des propriétés spéciales
      if (parsedData.caption || parsedData.dataNom !== 'image' || parsedData.width || parsedData.class.length > 0) {
        currentGroup.push(img);
      } else {
        // Finaliser le groupe actuel s'il existe
        if (currentGroup.length > 0) {
          allGroups.push([...currentGroup]);
          currentGroup = [];
        }
      }
    }
    
    // Ajouter le dernier groupe
    if (currentGroup.length > 0) {
      allGroups.push(currentGroup);
    }
    
    // Créer les conteneurs pour chaque groupe
    allGroups.forEach(group => {
      if (group.length > 0) {
        const firstImg = group[0];
        const parent = firstImg.parentElement;
        if (!parent) return;
        
        // Créer le conteneur grid
        const gridContainer = parent.createEl('div', { cls: 'figure-grid-container' });
        
        // Insérer avant la première image
        parent.insertBefore(gridContainer, firstImg);
        
        // Déplacer toutes les images du groupe
        group.forEach(img => {
          gridContainer.appendChild(img);
        });
      }
    });
  }

  async processStandaloneImage(img: HTMLElement) {
    const parsedData = this.parseImageData(img);
    const parent = img.parentElement;
    
    if (parent && (parsedData.caption || parsedData.dataNom !== 'image') && !img.closest('figure') && !img.closest('.imagenote')) {
      // Créer un conteneur grid pour l'image standalone
      const gridContainer = parent.createEl('div', { cls: 'figure-grid-container' });
      parent.insertBefore(gridContainer, img);
      gridContainer.appendChild(img);
      
      // Traiter l'image dans son nouveau conteneur
      await this.createFigureInGrid(img, parsedData);
    }
  }

  parseImageData(img: HTMLElement | Element) {
    let altText = img.getAttribute('alt') || ''
    const src = img.getAttribute('src') || ''
    
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
    
    // Check if it's the default Obsidian behavior
    const edge = altText.replace(/ > /, '#')
    if (altText === src || edge === src) {
      result.caption = ''
      return result
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

  generateSlug(src: string): string {
    const filename = src.split('/').pop() || src
    const nameWithoutExt = filename.replace(/\.[^.]+$/, '')
    return nameWithoutExt
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }

  getCaptionText(img: HTMLElement | Element) {
    const parsedData = this.parseImageData(img)
    return parsedData.caption
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }

  onunload() {
    this.observer.disconnect()
  }
}

export async function renderMarkdown(markdown: string, sourcePath: string, component: Component): Promise<NodeList | undefined> {
  const el = createDiv()
  await MarkdownRenderer.renderMarkdown(markdown, el, sourcePath, component)
  for (const child of el.children) {
    if (child.tagName.toLowerCase() === 'p') {
      return child.childNodes
    }
  }
}