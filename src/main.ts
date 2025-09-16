import {
  Component,
  MarkdownPostProcessor,
  MarkdownRenderer,
  Plugin,
  TFile,
} from "obsidian";
import {
  CaptionSettings,
  CaptionSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";

const filenamePlaceholder = "%";
const filenameExtensionPlaceholder = "%.%";

export default class ImageCaptions extends Plugin {
  settings: CaptionSettings;
  observer: MutationObserver;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new CaptionSettingTab(this.app, this));
    this.registerMarkdownCodeBlockProcessor(
      "columnGrid",
      this.figureGridProcessor.bind(this)
    );
    this.registerMarkdownPostProcessor(this.externalImageProcessor());
    this.addEditOnClickToGrids();

    this.observer = new MutationObserver((mutations: MutationRecord[]) => {
      mutations.forEach((rec: MutationRecord) => {
        if (rec.type === "childList") {
          this.processChildListChanges(rec);
        }
        if (rec.type === "attributes" && rec.target instanceof HTMLElement) {
          this.processAttributeChanges(rec);
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

  processChildListChanges(rec: MutationRecord) {
    (<Element>rec.target)
      .querySelectorAll(".image-embed, .video-embed, .internal-embed")
      .forEach(async (embedContainer) => {
        const img = embedContainer.querySelector("img, video");
        if (!img) return;

        const altText = embedContainer.getAttribute("alt") || "";
        const parsedAlt = this.parseAltAttributes(altText);

        if (parsedAlt.caption) {
          embedContainer.setAttribute("alt", parsedAlt.caption);
        }

        const figure = embedContainer.querySelector("figure");
        const figCaption = embedContainer.querySelector("figcaption");

        if (figure || img.parentElement?.nodeName === "FIGURE") {
          const targetFigure = figure || img.parentElement;
          
          if (figCaption && parsedAlt.caption) {
            const children = await this.renderMarkdown(parsedAlt.caption, "");
            this.updateFigcaption(figCaption, children);
          }
          
          // Mise à jour des styles pour la figure existante
          if (targetFigure) {
            this.updateFigureStyles(targetFigure as HTMLElement, parsedAlt);
          }
        } else if (parsedAlt.caption && parsedAlt.caption !== embedContainer.getAttribute("src")) {
          await this.insertFigureWithCaption(img as HTMLElement, embedContainer, parsedAlt, "");
        }
      });
  }

  processAttributeChanges(rec: MutationRecord) {
    const target = rec.target as HTMLElement;

    if (target.classList.contains("internal-embed") && rec.attributeName === "alt") {
      const altText = target.getAttribute("alt") || "";
      const parsedAlt = this.parseAltAttributes(altText);
      const img = target.querySelector("img, video");

      if (img) {
        const parentFigure = img.closest("figure");
        if (parentFigure) {
          // Mise à jour des classes
          if (parsedAlt.class && parsedAlt.class.length > 0) {
            parentFigure.classList.value = "figure";
            parsedAlt.class.forEach((cls: string) => parentFigure.classList.add(cls));
          }
          
          // Mise à jour des styles
          this.updateFigureStyles(parentFigure, parsedAlt);
        }
      }
    }

    if ((target.tagName === "IMG" || target.tagName === "VIDEO") && (rec.attributeName === "alt" || rec.attributeName === "src")) {
      setTimeout(async () => {
        const parent = target.parentElement;
        if (parent && parent.nodeName === "FIGURE") {
          const figCaption = parent.querySelector("figcaption");
          const parsedData = this.parseAltAttributes(target.getAttribute("alt") || "");
          
          // Mise à jour de la légende
          if (figCaption && parsedData.caption) {
            const children = await this.renderMarkdown(parsedData.caption, "");
            this.updateFigcaption(figCaption, children);
          }
          
          // Mise à jour des styles
          this.updateFigureStyles(parent, parsedData);
        }
      }, 10);
    }
  }

  parseAltAttributes(altText: string) {
    const result = {
      caption: "",
      class: [] as string[],
      width: undefined as string | undefined,
      col: undefined as string | undefined,
      "print-col": undefined as string | undefined,
      "print-width": undefined as string | undefined,
      "print-row": undefined as string | undefined,
      "print-height": undefined as string | undefined,
      "print-x": undefined as string | undefined,
      "print-y": undefined as string | undefined,
      "img-w": undefined as string | undefined,
      dataNom: "image" as string,
    };

    if (!altText) return result;

    const cleanedAltText = altText.replace(/\s+/g, " ").trim();
    const parts = cleanedAltText.split("|").map((part) => part.trim());

    for (const part of parts) {
      if (part.includes(":")) {
        const [key, ...valueParts] = part.split(":");
        const value = valueParts.join(":").trim();

        switch (key.toLowerCase()) {
          case "caption":
            result.caption = value;
            break;
          case "class":
            result.class = value.split(",").map((cls) => cls.trim());
            break;
          case "width":
            result.width = value;
            break;
          case "col":
            result.col = value;
            break;
          case "print-col":
          case "printcol":
            result["print-col"] = value;
            break;
          case "print-width":
          case "printwidth":
            result["print-width"] = value;
            break;
          case "print-row":
          case "printrow":
            result["print-row"] = value;
            break;
          case "print-height":
          case "printheight":
            result["print-height"] = value;
            break;
          case "img-x":
          case "imgx":
            result["print-x"] = value;
            break;
          case "img-y":
          case "imgy":
            result["print-y"] = value;
            break;
          case "img-w":
          case "imgw":
            result["img-w"] = value;
            break;
          case "type":
          case "datanom":
            result.dataNom = value;
            break;
        }
      } else if (part && !result.caption) {
        result.caption = part;
      }
    }

    return result;
  }

  // Méthode utilitaire pour mettre à jour les styles d'une figure
  private updateFigureStyles(figure: HTMLElement, parsedData: any) {
    const styles: string[] = [];
    
    if (parsedData.width) {
      styles.push(`--width: ${parsedData.width}`);
    }
    
    if (parsedData.col) {
      styles.push(`--col: ${parsedData.col}`);
    }
    
    if (parsedData["print-col"]) {
      styles.push(`--print-col: ${parsedData["print-col"]}`);
    }
    
    if (parsedData["print-width"]) {
      styles.push(`--print-width: ${parsedData["print-width"]}`);
    }
    
    if (parsedData["print-row"]) {
      styles.push(`--print-row: ${parsedData["print-row"]}`);
    }
    
    if (parsedData["print-height"]) {
      styles.push(`--print-height: ${parsedData["print-height"]}`);
    }
    
    if (parsedData["print-x"]) {
      styles.push(`--print-x: ${parsedData["print-x"]}`);
    }
    
    if (parsedData["print-y"]) {
      styles.push(`--print-y: ${parsedData["print-y"]}`);
    }
    
    if (parsedData["img-w"]) {
      styles.push(`--img-w: ${parsedData["img-w"]}`);
    }

    // Application des styles
    if (styles.length > 0) {
      figure.setAttribute("style", styles.join("; "));
    } else {
      // Supprimer l'attribut style s'il n'y a plus de styles
      figure.removeAttribute("style");
    }
  }

  async insertFigureWithCaption(
    imageEl: HTMLElement,
    outerEl: HTMLElement | Element,
    parsedData: any,
    sourcePath: string
  ) {
    let container: HTMLElement;

    if (parsedData.caption) {
      imageEl.setAttribute("alt", parsedData.caption);
    } else {
      imageEl.removeAttribute("alt");
    }

    container = outerEl.createEl("figure");
    container.addClass("figure");

    if (parsedData.class && parsedData.class.length > 0) {
      parsedData.class.forEach((cls: string) => container.addClass(cls));
    }

    // Utilisation de la méthode utilitaire pour les styles
    this.updateFigureStyles(container, parsedData);

    container.appendChild(imageEl);

    if (parsedData.caption) {
      const figcaption = container.createEl("figcaption", { cls: "figcaption" });
      const children = await this.renderMarkdown(parsedData.caption, sourcePath);
      this.updateFigcaption(figcaption, children);
    }
  }

  figureGridProcessor = (source: string, el: HTMLElement, ctx: any) => {
    const container = el.createDiv({ cls: "columnGrid" });
    const wikilinks = this.extractWikilinks(source);

    const promises = wikilinks.map((wikilink) => {
      return this.processGridImage(wikilink, container, ctx.sourcePath);
    });

    Promise.all(promises);
  };

  private extractWikilinks(source: string): string[] {
    const wikilinks: string[] = [];
    let current = "";
    let inWikilink = false;
    let bracketCount = 0;

    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      const nextChar = source[i + 1];

      if (char === "!" && nextChar === "[") {
        inWikilink = true;
        current = "![";
        bracketCount = 1;
        i += 1;
      } else if (inWikilink) {
        current += char;

        if (char === "[") {
          bracketCount++;
        } else if (char === "]") {
          bracketCount--;

          if (bracketCount === 0) {
            wikilinks.push(current);
            current = "";
            inWikilink = false;
          }
        }
      }
    }

    return wikilinks;
  }

  async processGridImage(imageSyntax: string, container: HTMLElement, sourcePath: string) {
    const cleanSyntax = imageSyntax.replace(/\s+/g, " ").trim();
    const match = cleanSyntax.match(/!\[\[\s*([^|\]]+?)\s*(?:\|([\s\S]+?))?\]\]/);

    if (!match) return;

    const imagePath = match[1].trim();
    const params = match[2] ? match[2].trim() : "";
    const abstractFile = this.app.metadataCache.getFirstLinkpathDest(imagePath, sourcePath);

    if (!abstractFile) {
      console.warn(`Fichier introuvable : ${imagePath}`);
      return;
    }

    const resolvedPath = this.app.vault.getResourcePath(abstractFile);
    const img = container.createEl("img");
    img.src = resolvedPath;
    img.setAttribute("alt", params);

    const parsedData = this.parseAltAttributes(params);
    await this.insertFigureWithCaption(img, container, parsedData, sourcePath);
  }

  private addEditOnClickToGrids() {
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const gridContainer = target.closest(".columnGrid");

      if (gridContainer) {
        let editButton = gridContainer.parentElement?.querySelector(".edit-block-button") as HTMLElement;

        if (!editButton) {
          let parent = gridContainer.parentElement;
          while (parent && !editButton) {
            editButton = parent.querySelector(".edit-block-button") as HTMLElement;
            parent = parent.parentElement;
          }
        }

        if (editButton) {
          editButton.click();
          event.preventDefault();
          event.stopPropagation();
        }
      }
    });
  }

  externalImageProcessor(): MarkdownPostProcessor {
    return (el, ctx) => {
      el.findAll("img:not(.emoji), video").forEach(async (img) => {
        const altText = img.getAttribute("alt") || "";
        const parsedData = this.parseAltAttributes(altText);
        const parent = img.parentElement;

        if (parent && parent.nodeName !== "FIGURE" && parsedData.caption && parsedData.caption !== img.getAttribute("src")) {
          await this.insertFigureWithCaption(img, parent, parsedData, ctx.sourcePath);
        }
      });
    };
  }

  async renderMarkdown(markdown: string, sourcePath: string): Promise<Node[]> {
    const el = createDiv();
    await MarkdownRenderer.renderMarkdown(markdown, el, sourcePath, this);

    const nodes: Node[] = [];
    for (const child of el.childNodes) {
      nodes.push(child);
    }

    return nodes.length > 0 ? nodes : [document.createTextNode(markdown)];
  }

  private updateFigcaption(figcaption: HTMLElement, children: Node[]) {
    if (children.length === 1 && children[0] instanceof HTMLParagraphElement) {
      const pElement = children[0] as HTMLParagraphElement;
      figcaption.replaceChildren(...Array.from(pElement.childNodes));
    } else {
      figcaption.replaceChildren(...children);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  onunload() {
    this.observer.disconnect();
  }
}