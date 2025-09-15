import {
  Component,
  MarkdownPostProcessor,
  MarkdownRenderer,
  Plugin,
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
    document.documentElement.style.setProperty(
      "--window-width",
      window.outerWidth + "px"
    );
    window.addEventListener("resize", () => {
      document.documentElement.style.setProperty(
        "--window-width",
        window.outerWidth + "px"
      );
    });

    // Register code block processor for figure-grid-container
    this.registerMarkdownCodeBlockProcessor(
      "figure-grid-container",
      this.figureGridProcessor.bind(this)
    );

    this.registerMarkdownPostProcessor(this.externalImageProcessor());

    // Ajouter le clic pour éditer les grilles
    this.addEditOnClickToGrids();

    await this.loadSettings();
    this.addSettingTab(new CaptionSettingTab(this.app, this));

    this.observer = new MutationObserver((mutations: MutationRecord[]) => {
      mutations.forEach((rec: MutationRecord) => {
        if (rec.type === "childList") {
          (<Element>rec.target)
            .querySelectorAll(".image-embed, .video-embed")
            .forEach(async (imageEmbedContainer) => {
              const img = imageEmbedContainer.querySelector("img, video");
              const width = imageEmbedContainer.getAttribute("width") || "";
              const parsedData = this.parseImageData(imageEmbedContainer);

              if (parsedData.caption) {
                imageEmbedContainer.setAttribute("alt", parsedData.caption);
              }

              if (!img) return;
              const figure = imageEmbedContainer.querySelector("figure");
              const figCaption =
                imageEmbedContainer.querySelector("figcaption");
              if (figure || img.parentElement?.nodeName === "FIGURE") {
                if (figCaption && parsedData.caption) {
                  const children = (await renderMarkdown(
                    parsedData.caption,
                    "",
                    this
                  )) ?? [parsedData.caption];
                  figCaption.replaceChildren(...children);
                } else if (!parsedData.caption) {
                  imageEmbedContainer.appendChild(img);
                  figure?.remove();
                }
              } else {
                if (
                  parsedData.caption &&
                  parsedData.caption !== imageEmbedContainer.getAttribute("src")
                ) {
                  await this.insertFigureWithCaption(
                    img as HTMLElement,
                    imageEmbedContainer,
                    parsedData,
                    ""
                  );
                }
              }
              if (width) {
                img.setAttribute("width", width);
              } else {
                img.removeAttribute("width");
              }
            });
        }
      });
    });
    this.observer.observe(document.body, {
      subtree: true,
      childList: true,
    });
  }

  // Processor pour les blocs de code figure-grid-container avec support multiligne
  figureGridProcessor = (source: string, el: HTMLElement, ctx: any) => {
    const container = el.createDiv({ cls: "figure-grid-container" });
    
    // Extraire les wikilinks (même multiligne)
    const wikilinks = this.extractWikilinks(source);
    
    const promises = wikilinks.map((wikilink) => {
      return this.processGridImageSync(wikilink, container, ctx.sourcePath);
    });

    Promise.all(promises);
  };

  // Extraction des wikilinks multiligne
  private extractWikilinks(source: string): string[] {
    const wikilinks: string[] = [];
    let current = '';
    let inWikilink = false;
    let bracketCount = 0;
    
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      const nextChar = source[i + 1];
      
      if (char === '!' && nextChar === '[' && source[i + 2] === '[') {
        // Début d'un wikilink
        inWikilink = true;
        current = '![[';
        bracketCount = 2;
        i += 2; // Skip les deux crochets
      } else if (inWikilink) {
        current += char;
        
        if (char === '[') {
          bracketCount++;
        } else if (char === ']') {
          bracketCount--;
          
          if (bracketCount === 0) {
            // Fin du wikilink
            wikilinks.push(current);
            current = '';
            inWikilink = false;
          }
        }
      }
    }
    
    return wikilinks;
  }

  // Version asynchrone pour le parsing markdown
async processGridImageSync(
  imageSyntax: string,
  container: HTMLElement,
  sourcePath: string
) {
  // Nettoyer les retours à la ligne et espaces multiples
  const cleanSyntax = imageSyntax.replace(/\s+/g, ' ').trim();
  
  // Nouvelle regex pour capturer le chemin même s'il y a des espaces/retours
  const match = cleanSyntax.match(/!\[\[\s*([^|\]]+?)\s*(?:\|(.+))?\]\]/);
  if (!match) return;

  const imagePath = match[1].trim();
  const params = match[2] || "";

  // Résolution du chemin wikilink
  const abstractFile = this.app.metadataCache.getFirstLinkpathDest(
    imagePath,
    sourcePath
  );
  if (!abstractFile) {
    console.warn(`Fichier introuvable : ${imagePath}`);
    return;
  }

  const resolvedPath = this.app.vault.getResourcePath(abstractFile);
  const img = container.createEl("img");
  img.src = resolvedPath;
  img.setAttribute("alt", params);

  const parsedData = this.parseImageData(img);

  // Traitement asynchrone pour le markdown
  await this.insertFigureWithCaptionSync(img, container, parsedData, sourcePath);
}



  // Version asynchrone de insertFigureWithCaption pour les grilles avec markdown
  async insertFigureWithCaptionSync(
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

    if (parsedData.dataNom === "imagenote") {
      container = outerEl.createEl("span");
      container.addClass("imagenote");
      container.setAttribute("id", parsedData.id);
      container.setAttribute("data-src", imageEl.getAttribute("src") || "");

      if (parsedData.class && parsedData.class.length > 0) {
        parsedData.class.forEach((cls: string) => container.addClass(cls));
      }

      container.appendChild(imageEl);

      if (parsedData.caption) {
        const captionSpan = container.createEl("span", { cls: "caption" });
        // Parsing markdown
        const children = (await renderMarkdown(
          parsedData.caption,
          sourcePath,
          this
        )) ?? [parsedData.caption];
        captionSpan.replaceChildren(...children);
      }
    } else {
      container = outerEl.createEl("figure");
      container.addClass("figure");
      container.setAttribute("data-nom", parsedData.dataNom);
      container.setAttribute("id", parsedData.id);

      if (parsedData.class && parsedData.class.length > 0) {
        parsedData.class.forEach((cls: string) => container.addClass(cls));
      }

      this.applyStyleProperties(container, parsedData);

      container.appendChild(imageEl);

      if (parsedData.caption) {
        const figcaption = container.createEl("figcaption", {
          cls: "figcaption",
        });
        // Parsing markdown
        const children = (await renderMarkdown(
          parsedData.caption,
          sourcePath,
          this
        )) ?? [parsedData.caption];
        figcaption.replaceChildren(...children);
      }
    }
  }

  // Clic pour éditer les grilles
private addEditOnClickToGrids() {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const gridContainer = target.closest('.figure-grid-container');
    
    if (gridContainer) {
      // Chercher le bouton d'édition dans différents parents possibles
      let editButton = gridContainer.parentElement?.querySelector('.edit-block-button') as HTMLElement;
      
      if (!editButton) {
        // Chercher plus haut dans la hiérarchie
        let parent = gridContainer.parentElement;
        while (parent && !editButton) {
          editButton = parent.querySelector('.edit-block-button') as HTMLElement;
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
  // Factorisation des propriétés de style
  private applyStyleProperties(container: HTMLElement, parsedData: any) {
    const style: string[] = [];
    if (parsedData.width) style.push(`--width: ${parsedData.width}`);
    if (parsedData.printwidth)
      style.push(`--print-width: ${parsedData.printwidth}`);
    if (parsedData.col) style.push(`--col: ${parsedData.col}`);
    if (parsedData.printcol) style.push(`--print-col: ${parsedData.printcol}`);
    if (parsedData.imgX) style.push(`--img-x: ${parsedData.imgX}`);
    if (parsedData.imgY) style.push(`--img-y: ${parsedData.imgY}`);
    if (parsedData.imgW) style.push(`--img-w: ${parsedData.imgW}`);

    if (style.length > 0) {
      container.setAttribute("style", style.join("; "));
    }
  }

  parseImageData(img: HTMLElement | Element) {
    let altText = img.getAttribute("alt") || "";
    const src = img.getAttribute("src") || "";

    const parts = altText.split("|").map((part) => part.trim());

    const result = {
      dataNom: "image",
      caption: "",
      width: undefined as string | undefined,
      printwidth: undefined as string | undefined,
      col: undefined as string | undefined,
      printcol: undefined as string | undefined,
      class: [] as string[],
      poster: undefined as string | undefined,
      imgX: undefined as string | undefined,
      imgY: undefined as string | undefined,
      imgW: undefined as string | undefined,
      id: this.generateSlug(src),
    };

    // Check if it's the default Obsidian behavior
    const edge = altText.replace(/ > /, "#");
    if (altText === src || edge === src) {
      result.caption = "";
      return result;
    }

    // New syntax: first part is data-nom
    if (
      parts.length > 1 &&
      ["imagenote", "image", "imageGrid", "figure", "video"].includes(parts[0])
    ) {
      result.dataNom = parts[0];

      // Parse remaining parts as key:value
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];

        if (part.includes(":")) {
          const [key, ...valueParts] = part.split(":");
          const value = valueParts.join(":").trim();

          switch (key.toLowerCase()) {
            case "caption":
              result.caption = value;
              break;
            case "width":
              result.width = value;
              break;
            case "printwidth":
              result.printwidth = value;
              break;
            case "col":
              result.col = value;
              break;
            case "printcol":
              result.printcol = value;
              break;
            case "class":
              result.class = value.split(",").map((c) => c.trim());
              break;
            case "poster":
              result.poster = value;
              break;
            case "imgx":
              result.imgX = value;
              break;
            case "imgy":
              result.imgY = value;
              break;
            case "imgw":
              result.imgW = value;
              break;
            case "id":
              result.id = value;
              break;
          }
        }
      }
    } else {
      // Old syntax: first part is caption
      result.caption = parts[0];
    }

    // Apply existing logic
    if (this.settings.captionRegex && result.caption) {
      try {
        const match = result.caption.match(
          new RegExp(this.settings.captionRegex)
        );
        result.caption = match?.[1] || "";
      } catch (e) {
        console.warn("Invalid regex in settings:", this.settings.captionRegex);
      }
    }

    if (result.caption === filenamePlaceholder) {
      const match = src.match(/[^\\/]+(?=\.\w+$)|[^\\/]+$/);
      result.caption = match?.[0] || "";
    } else if (result.caption === filenameExtensionPlaceholder) {
      const match = src.match(/[^\\/]+$/);
      result.caption = match?.[0] || "";
    } else if (result.caption === "\\" + filenamePlaceholder) {
      result.caption = filenamePlaceholder;
    }

    result.caption = result.caption.replace(
      /<<(.*?)>>/g,
      (_, linktext) => "[[" + linktext + "]]"
    );

    return result;
  }

  generateSlug(src: string): string {
    const filename = src.split("/").pop() || src;
    const nameWithoutExt = filename.replace(/\.[^.]+$/, "");
    return nameWithoutExt
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  getCaptionText(img: HTMLElement | Element) {
    const parsedData = this.parseImageData(img);
    return parsedData.caption;
  }

  externalImageProcessor(): MarkdownPostProcessor {
    return (el, ctx) => {
      el.findAll("img:not(.emoji), video").forEach(async (img) => {
        const parsedData = this.parseImageData(img);
        const parent = img.parentElement;
        if (
          parent &&
          parent?.nodeName !== "FIGURE" &&
          parsedData.caption &&
          parsedData.caption !== img.getAttribute("src")
        ) {
          await this.insertFigureWithCaption(
            img,
            parent,
            parsedData,
            ctx.sourcePath
          );
        }
      });
    };
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

    if (parsedData.dataNom === "imagenote") {
      container = outerEl.createEl("span");
      container.addClass("imagenote");
      container.setAttribute("id", parsedData.id);
      container.setAttribute("data-src", imageEl.getAttribute("src") || "");

      if (parsedData.class && parsedData.class.length > 0) {
        parsedData.class.forEach((cls: string) => container.addClass(cls));
      }

      container.appendChild(imageEl);

      if (parsedData.caption) {
        const captionSpan = container.createEl("span", { cls: "caption" });
        const children = (await renderMarkdown(
          parsedData.caption,
          sourcePath,
          this
        )) ?? [parsedData.caption];
        captionSpan.replaceChildren(...children);
      }
    } else if (parsedData.dataNom === "video") {
      container = outerEl.createEl("figure");
      container.addClass("videofigure");
      container.setAttribute("data-src", imageEl.getAttribute("src") || "");

      if (parsedData.class && parsedData.class.length > 0) {
        parsedData.class.forEach((cls: string) => container.addClass(cls));
      }

      this.applyStyleProperties(container, parsedData);

      const videoDiv = container.createEl("div", { cls: "video" });
      if (parsedData.poster) {
        videoDiv.setAttribute(
          "style",
          `background-image: url(${parsedData.poster})`
        );
      }

      const src = imageEl.getAttribute("src") || "";
      const videoContent = this.createVideoContent(src);
      if (videoContent) {
        videoDiv.innerHTML = videoContent;
      } else {
        videoDiv.appendChild(imageEl);
      }

      if (parsedData.caption) {
        const children = (await renderMarkdown(
          parsedData.caption,
          sourcePath,
          this
        )) ?? [parsedData.caption];
        container
          .createEl("figcaption", {
            cls: "figcaption",
          })
          .replaceChildren(...children);
      }
    } else {
      container = outerEl.createEl("figure");
      container.addClass("figure");
      container.setAttribute("data-nom", parsedData.dataNom);
      container.setAttribute("id", parsedData.id);

      if (parsedData.class && parsedData.class.length > 0) {
        parsedData.class.forEach((cls: string) => container.addClass(cls));
      }

      this.applyStyleProperties(container, parsedData);

      if (parsedData.poster && imageEl.tagName.toLowerCase() === "video") {
        imageEl.setAttribute("poster", parsedData.poster);
      }

      container.appendChild(imageEl);

      if (parsedData.caption) {
        const children = (await renderMarkdown(
          parsedData.caption,
          sourcePath,
          this
        )) ?? [parsedData.caption];
        container
          .createEl("figcaption", {
            cls: "figcaption",
          })
          .replaceChildren(...children);
      }
    }
  }

  createVideoContent(url: string): string | null {
    if (url.includes("yout")) {
      return this.createYouTubeEmbed(url);
    }
    if (url.includes("vimeo")) {
      return this.createVimeoEmbed(url);
    }
    return null;
  }

  createYouTubeEmbed(url: string): string | null {
    const match = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/
    );
    if (!match) return null;

    const videoId = match[1];
    const src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;

    return `<youtube-embed><iframe scrolling='no' width='640' height='360' allow='autoplay; fullscreen' src='' data-src='${src}'></iframe><button aria-label='Play video'></button></youtube-embed>`;
  }

  createVimeoEmbed(url: string): string | null {
    const match = url.match(
      /(?:vimeo\.com\/|player\.vimeo\.com\/video\/)([0-9]+)/
    );
    if (!match) return null;

    const videoId = match[1];
    const src = `https://player.vimeo.com/video/${videoId}?autoplay=1&rel=0`;

    return `<vimeo-embed><iframe scrolling='no' width='640' height='360' allow='autoplay; fullscreen' src='' data-src='${src}'></iframe><button aria-label='Play video'></button></vimeo-embed>`;
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

export async function renderMarkdown(
  markdown: string,
  sourcePath: string,
  component: Component
): Promise<NodeList | undefined> {
  const el = createDiv();
  await MarkdownRenderer.renderMarkdown(markdown, el, sourcePath, component);
  for (const child of el.children) {
    if (child.tagName.toLowerCase() === "p") {
      return child.childNodes;
    }
  }
}