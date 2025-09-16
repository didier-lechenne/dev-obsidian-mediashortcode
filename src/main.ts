import {
  MarkdownPostProcessor,
  MarkdownRenderer,
  Plugin,
} from "obsidian";
import {
  CaptionSettings,
  CaptionSettingTab,
  DEFAULT_SETTINGS,
  MediaType,
} from "./settings";

// ==================== INTERFACES ====================

interface ParsedMediaData {
  type: string;
  caption: string;
  classes: string[];
  width?: string;
  col?: string;
  [key: string]: any;
}

interface TemplateData {
  type: string;
  classes: string;
  id: string;
  src: string;
  media: string;
  caption: string;
}

// ==================== TYPE DETECTOR ====================

class TypeDetector {
  constructor(private mediaTypes: Record<string, MediaType>) {}

  detectFromFilename(filename: string): string {
    const ext = this.getFileExtension(filename);
    
    for (const [typeName, config] of Object.entries(this.mediaTypes)) {
      if (config.extensions.includes(ext)) {
        return typeName;
      }
    }
    
    return 'figure'; // fallback is 'figure'
  }

  detectFromKeyword(params: string[]): string | null {
    const keywords = Object.keys(this.mediaTypes);
    
    for (const param of params) {
      if (keywords.includes(param.toLowerCase())) {
        return param.toLowerCase();
      }
    }
    
    return null;
  }

  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot === -1 ? '' : filename.substring(lastDot).toLowerCase();
  }
}

// ==================== MEDIA PARSER ====================

class MediaParser {
  constructor(private typeDetector: TypeDetector) {}

  parseAttributes(altText: string, filename?: string): ParsedMediaData {
    const result: ParsedMediaData = {
      type: 'figure', // default type is 'figure'
      caption: '',
      classes: [],
    };

    if (!altText) {
      if (filename) {
        result.type = this.typeDetector.detectFromFilename(filename);
      }
      return result;
    }

    const cleanedAltText = altText.replace(/\s+/g, ' ').trim();
    const parts = cleanedAltText.split('|').map(part => part.trim());

    // Détecter le type depuis les mots-clés
    const keywordType = this.typeDetector.detectFromKeyword(parts);
    if (keywordType) {
      result.type = keywordType;
      // Enlever le mot-clé de la liste des parties
      const keywordIndex = parts.findIndex(p => p.toLowerCase() === keywordType);
      if (keywordIndex !== -1) {
        parts.splice(keywordIndex, 1);
      }
    } else if (filename) {
      // Détection par extension si pas de mot-clé
      result.type = this.typeDetector.detectFromFilename(filename);
    }

    // Parser les autres paramètres
    for (const part of parts) {
      if (part.includes(':')) {
        this.parseKeyValuePair(part, result);
      } else if (part && !result.caption) {
        result.caption = part;
      }
    }

    return result;
  }

  private parseKeyValuePair(part: string, result: ParsedMediaData): void {
    const [key, ...valueParts] = part.split(':');
    const value = valueParts.join(':').trim();

    switch (key.toLowerCase()) {
      case 'caption':
        result.caption = value;
        break;
      case 'class':
        result.classes = value.split(',').map(cls => cls.trim());
        break;
      case 'width':
        result.width = value;
        break;
      case 'col':
        result.col = value;
        break;
      case 'print-col':
      case 'printcol':
        result['print-col'] = value;
        break;
      case 'print-width':
      case 'printwidth':
        result['print-width'] = value;
        break;
      case 'print-row':
      case 'printrow':
        result['print-row'] = value;
        break;
      case 'print-height':
      case 'printheight':
        result['print-height'] = value;
        break;
      case 'print-x':
      case 'img-x':
      case 'imgx':
        result['print-x'] = value;
        break;
      case 'print-y':
      case 'img-y':
      case 'imgy':
        result['print-y'] = value;
        break;
      case 'img-w':
      case 'imgw':
        result['img-w'] = value;
        break;
      default:
        // Stocker autres propriétés dynamiquement
        result[key.toLowerCase()] = value;
        break;
    }
  }
}

// ==================== TEMPLATE ENGINE ====================

class TemplateEngine {
  render(template: string, data: TemplateData): string {
    return template
      .replace(/{type}/g, data.type)
      .replace(/{classes}/g, data.classes)
      .replace(/{id}/g, data.id)
      .replace(/{src}/g, data.src)
      .replace(/{media}/g, data.media)
      .replace(/{caption}/g, data.caption);
  }
}

// ==================== MEDIA RENDERER ====================

class MediaRenderer {
  constructor(
    private templateEngine: TemplateEngine,
    private mediaTypes: Record<string, MediaType>,
    private plugin: ImageCaptions
  ) {}

  async renderMedia(
    mediaEl: HTMLElement,
    container: HTMLElement | Element,
    parsedData: ParsedMediaData,
    sourcePath: string
  ): Promise<void> {
    const mediaType = this.mediaTypes[parsedData.type] || this.mediaTypes.figure; // fallback to figure
    
    // Générer les données pour le template
    const templateData: TemplateData = {
      type: parsedData.type,
      classes: parsedData.classes.join(' '),
      id: this.generateId(mediaEl),
      src: mediaEl.getAttribute('src') || '',
      media: '', // Sera remplacé par l'élément réel
      caption: parsedData.caption
    };

    // Rendre le template HTML (sans contenu)
    const htmlString = this.templateEngine.render(mediaType.template, templateData);
    
    // Créer l'élément conteneur
    const tempDiv = createDiv();
    tempDiv.innerHTML = htmlString;
    const newContainer = tempDiv.firstElementChild as HTMLElement;
    
    if (newContainer) {
      // Pour le type "grid", gérer la structure spéciale
      if (parsedData.type === "grid") {
        // Template grid: <figure>{media}</figure><figcaption>{caption}</figcaption>
        // Récupérer tous les éléments créés par le template
        const allElements = Array.from(tempDiv.children);
        const figureEl = tempDiv.querySelector('figure');
        const captionEl = tempDiv.querySelector('figcaption');
        
        if (figureEl) {
          // Corriger l'attribut alt de l'image
          if (parsedData.caption) {
            mediaEl.setAttribute('alt', parsedData.caption);
          }
          figureEl.appendChild(mediaEl);
          
          // Appliquer les styles sur figure
          this.applyStyles(figureEl, parsedData);
        }
        
        // Remplir et styliser la caption
        if (parsedData.caption && captionEl) {
          const children = await this.renderMarkdown(parsedData.caption, sourcePath);
          this.updateCaption(captionEl, children);
          
          // Appliquer les styles sur caption aussi
          this.applyStyles(captionEl, parsedData);
        }
        
        // Ajouter tous les éléments au conteneur
        allElements.forEach(el => container.appendChild(el));
        
        return; // Sortir tôt pour éviter le code normal
      } else {
        // Logique normale pour les autres types
        newContainer.innerHTML = '';
        
        // Corriger l'attribut alt de l'image
        if (parsedData.caption) {
          mediaEl.setAttribute('alt', parsedData.caption);
        }
        
        // Ajouter l'image
        newContainer.appendChild(mediaEl);

        // Ajouter la caption si elle existe
        if (parsedData.caption) {
          let captionEl: HTMLElement;
          if (parsedData.type === "imagenote" || parsedData.type === "video") {
            captionEl = newContainer.createEl("span", { cls: "figcaption" });
          } else if (parsedData.type === "audio" || parsedData.type === "pdf") {
            captionEl = newContainer.createEl("div", { cls: "figcaption" });
          } else {
            captionEl = newContainer.createEl("figcaption", { cls: "figcaption" });
          }
          
          const children = await this.renderMarkdown(parsedData.caption, sourcePath);
          this.updateCaption(captionEl, children);
        }
      }

      // Appliquer les styles CSS seulement pour les types non-grid
      // (grid gère ses styles séparément)
      if (parsedData.type !== "grid") {
        this.applyStyles(newContainer, parsedData);
      }
      
      // Remplacer l'ancien conteneur seulement pour les types non-grid
      if (parsedData.type !== "grid") {
        container.appendChild(newContainer);
      }
    }
  }

  private generateId(mediaEl: HTMLElement): string {
    const src = mediaEl.getAttribute('src') || '';
    const filename = src.split('/').pop()?.replace(/\?.*$/, '')?.replace(/\./g, '') || '';
    return `content${filename}`;
  }

  private applyStyles(container: HTMLElement, parsedData: ParsedMediaData): void {
    const styles: string[] = [];
    const excludedProps = ['type', 'caption', 'classes'];
    
    // Styles CSS variables pour toutes les propriétés personnalisées
    Object.entries(parsedData).forEach(([key, value]) => {
      if (typeof value === 'string' && !excludedProps.includes(key)) {
        styles.push(`--${key}: ${value}`);
      }
    });

    if (styles.length > 0) {
      container.setAttribute('style', styles.join('; '));
    }
  }

  private async renderMarkdown(markdown: string, sourcePath: string): Promise<Node[]> {
    const el = createDiv();
    await MarkdownRenderer.renderMarkdown(markdown, el, sourcePath, this.plugin);

    const nodes: Node[] = [];
    for (const child of el.childNodes) {
      nodes.push(child);
    }

    return nodes.length > 0 ? nodes : [document.createTextNode(markdown)];
  }

  private updateCaption(captionEl: Element, children: Node[]): void {
    if (children.length === 1 && children[0] instanceof HTMLParagraphElement) {
      const pElement = children[0] as HTMLParagraphElement;
      captionEl.replaceChildren(...Array.from(pElement.childNodes));
    } else {
      captionEl.replaceChildren(...children);
    }
  }
}

// ==================== MAIN PLUGIN ====================

export default class ImageCaptions extends Plugin {
  settings: CaptionSettings;
  observer: MutationObserver;
  
  private typeDetector: TypeDetector;
  private mediaParser: MediaParser;
  private templateEngine: TemplateEngine;
  private mediaRenderer: MediaRenderer;

  async onload() {
    await this.loadSettings();
    
    // Initialiser les composants
    this.typeDetector = new TypeDetector(this.settings.mediaTypes);
    this.mediaParser = new MediaParser(this.typeDetector);
    this.templateEngine = new TemplateEngine();
    this.mediaRenderer = new MediaRenderer(this.templateEngine, this.settings.mediaTypes, this);

    this.addSettingTab(new CaptionSettingTab(this.app, this));
    
    this.registerMarkdownCodeBlockProcessor("columnGrid", this.figureGridProcessor.bind(this));
    this.registerMarkdownPostProcessor(this.mediaProcessor());
    
    this.setupMutationObserver();
    this.addEditOnClickToGrids();
  }

  private setupMutationObserver(): void {
    this.observer = new MutationObserver((mutations: MutationRecord[]) => {
      mutations.forEach(mutation => {
        if (mutation.type === "childList") {
          this.processChildListChanges(mutation);
        } else if (mutation.type === "attributes") {
          this.processAttributeChanges(mutation);
        }
      });
    });

    this.observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["alt", "src", "data-path"],
    });
  }

  private processChildListChanges(mutation: MutationRecord): void {
    // Debounce les changements pour éviter les traitements multiples
    setTimeout(() => {
      (<Element>mutation.target)
        .querySelectorAll(".image-embed, .video-embed, .internal-embed")
        .forEach(async (embedContainer) => {
          await this.processEmbedContainer(embedContainer);
        });
    }, 100);
  }

  private processAttributeChanges(mutation: MutationRecord): void {
    const target = mutation.target as HTMLElement;
    
    if (target.classList.contains("internal-embed") && mutation.attributeName === "alt") {
      setTimeout(() => this.processEmbedContainer(target, true), 100);
    }
    
    if ((target.tagName === "IMG" || target.tagName === "VIDEO" || target.tagName === "AUDIO") 
        && (mutation.attributeName === "alt" || mutation.attributeName === "src")) {
      setTimeout(() => this.updateExistingMedia(target), 10);
    }
  }

  private async processEmbedContainer(embedContainer: Element, force = false): Promise<void> {
    const mediaEl = embedContainer.querySelector("img, video, audio") as HTMLElement;
    if (!mediaEl) return;

    if (!force && this.isAlreadyProcessed(mediaEl)) return;

    // Éviter les boucles infinies - marquer le conteneur comme en cours de traitement
    if (embedContainer.hasAttribute('data-processing')) return;
    embedContainer.setAttribute('data-processing', 'true');

    // NETTOYER les anciens éléments traités
    if (force) {
      const existingElements = embedContainer.querySelectorAll('figure, span.imagenote, span.video, span.audio, div.pdf, .grid');
      existingElements.forEach(el => el.remove());
    }

    const altText = embedContainer.getAttribute("alt") || "";
    const src = mediaEl.getAttribute("src") || "";
    const filename = src.split('/').pop() || "";
    
    const parsedData = this.mediaParser.parseAttributes(altText, filename);

    if (this.shouldProcessMedia(parsedData)) {
      await this.mediaRenderer.renderMedia(mediaEl, embedContainer, parsedData, "");
    }

    // Retirer le marqueur après traitement
    embedContainer.removeAttribute('data-processing');
  }

  private async updateExistingMedia(target: HTMLElement): Promise<void> {
    const container = target.closest("figure, span[class*='imagenote'], span[class*='video'], span[class*='audio'], div[class*='pdf'], .grid");
    if (!container) return;

    const altText = target.getAttribute("alt") || "";
    const src = target.getAttribute("src") || "";
    const filename = src.split('/').pop() || "";
    
    const parsedData = this.mediaParser.parseAttributes(altText, filename);
    
    // Mettre à jour la caption
    const captionEl = container.querySelector(".figcaption, figcaption");
    if (captionEl && parsedData.caption) {
      const children = await this.mediaRenderer['renderMarkdown'](parsedData.caption, "");
      this.mediaRenderer['updateCaption'](captionEl, children);
    }
  }

  private shouldProcessMedia(parsedData: ParsedMediaData): boolean {
    return !!(
      parsedData.caption || 
      parsedData.col || 
      parsedData.width ||
      parsedData['print-col'] ||
      parsedData['print-width'] ||
      parsedData['print-row'] ||
      parsedData['print-height'] ||
      parsedData['print-x'] ||
      parsedData['print-y'] ||
      parsedData['img-w'] ||
      parsedData.type !== 'figure' // default type is 'figure'
    );
  }

  private figureGridProcessor = (source: string, el: HTMLElement, ctx: any): void => {
    const container = el.createDiv({ cls: "columnGrid" });
    const wikilinks = this.extractWikilinks(source);

    Promise.all(wikilinks.map(wikilink => 
      this.processGridImage(wikilink, container, ctx.sourcePath)
    ));
  };

  private extractWikilinks(source: string): string[] {
    const wikilinks: string[] = [];
    const regex = /!\[\[\s*([^|\]]+?)\s*(?:\|([\s\S]*?))?\]\]/g;
    let match;

    while ((match = regex.exec(source)) !== null) {
      wikilinks.push(match[0]);
    }

    return wikilinks;
  }

  private async processGridImage(imageSyntax: string, container: HTMLElement, sourcePath: string): Promise<void> {
    const match = imageSyntax.match(/!\[\[\s*([^|\]]+?)\s*(?:\|([\s\S]+?))?\]\]/);
    if (!match) return;

    const imagePath = match[1].trim();
    const params = match[2] ? match[2].trim() : "";
    
    const abstractFile = this.app.metadataCache.getFirstLinkpathDest(imagePath, sourcePath);
    if (!abstractFile) {
      console.warn(`File not found: ${imagePath}`);
      return;
    }

    const resolvedPath = this.app.vault.getResourcePath(abstractFile);
    const parsedData = this.mediaParser.parseAttributes(params, imagePath);
    
    // Créer l'élément média approprié
    let mediaEl: HTMLElement;
    if (parsedData.type === 'video') {
      mediaEl = container.createEl("video");
      mediaEl.setAttribute("controls", "");
    } else if (parsedData.type === 'audio') {
      mediaEl = container.createEl("audio");
      mediaEl.setAttribute("controls", "");
    } else {
      mediaEl = container.createEl("img");
    }
    
    mediaEl.setAttribute("src", resolvedPath);
    if (parsedData.caption) {
      mediaEl.setAttribute("alt", parsedData.caption);
    }

    await this.mediaRenderer.renderMedia(mediaEl, container, parsedData, sourcePath);
  }

  private mediaProcessor(): MarkdownPostProcessor {
    return (el, ctx) => {
      // Traiter les médias externes
      el.findAll("img:not(.emoji), video, audio").forEach(async (mediaEl) => {
        const altText = mediaEl.getAttribute("alt") || "";
        const src = mediaEl.getAttribute("src") || "";
        const filename = src.split('/').pop() || "";
        
        const parsedData = this.mediaParser.parseAttributes(altText, filename);
        const parent = mediaEl.parentElement;

        if (parent && !this.isAlreadyProcessed(mediaEl) && this.shouldProcessMedia(parsedData)) {
          await this.mediaRenderer.renderMedia(mediaEl as HTMLElement, parent, parsedData, ctx.sourcePath);
        }
      });

      // Traiter les embeds internes après un délai
      setTimeout(() => {
        el.findAll(".internal-embed").forEach(embedContainer => {
          this.processEmbedContainer(embedContainer);
        });
      }, 100);
    };
  }

  private isAlreadyProcessed(mediaEl: Element): boolean {
    const container = mediaEl.closest("figure, span[class*='imagenote'], span[class*='video'], span[class*='audio'], div[class*='pdf']");
    if (container && (container.classList.contains('grid') || container.classList.contains('figure') || container.classList.contains('imagenote') || container.classList.contains('video') || container.classList.contains('audio') || container.classList.contains('pdf'))) {
      return true;
    }
    return !!mediaEl.parentElement?.querySelector(".figcaption, figcaption");
  }

  private addEditOnClickToGrids(): void {
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const gridContainer = target.closest(".columnGrid");

      if (gridContainer) {
        const editButton = this.findEditButton(gridContainer);
        if (editButton) {
          editButton.click();
          event.preventDefault();
          event.stopPropagation();
        }
      }
    });
  }

  private findEditButton(container: Element): HTMLElement | null {
    let parent = container.parentElement;
    while (parent) {
      const editButton = parent.querySelector(".edit-block-button") as HTMLElement;
      if (editButton) return editButton;
      parent = parent.parentElement;
    }
    return null;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    
    // Réinitialiser les composants après changement de settings
    this.typeDetector = new TypeDetector(this.settings.mediaTypes);
    this.mediaParser = new MediaParser(this.typeDetector);
    this.mediaRenderer = new MediaRenderer(this.templateEngine, this.settings.mediaTypes, this);
  }

  onunload(): void {
    this.observer?.disconnect();
  }
}