import { Plugin, TFile, ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { moment } from "obsidian";

const VIEW_TYPE = "aliases-check-view";

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------
type Locale = "en" | "zh";

interface Translations {
  viewTitle: string;
  refreshTooltip: string;
  refreshBtn: string;
  noConflicts: string;
  summaryOne: string;
  summaryMultiple: (n: number) => string;
  conflictGroup: (i: number) => string;
  notesCount: (n: number) => string;
  compareBtn: string;
  conflictNamesLabel: string;
  aliasesLabel: (aliases: string) => string;
  splitLimitNotice: (max: number) => string;
  cannotOpenSidebar: string;
}

const TRANSLATIONS: Record<Locale, Translations> = {
  en: {
    viewTitle: "Aliases Check",
    refreshTooltip: "Refresh",
    refreshBtn: "Refresh",
    noConflicts: "No duplicate notes found.",
    summaryOne: "1 conflict group found",
    summaryMultiple: (n) => `${n} conflict groups found`,
    conflictGroup: (i) => `Conflict Group ${i}`,
    notesCount: (n) => `(${n} notes)`,
    compareBtn: "Compare",
    conflictNamesLabel: "Conflict names: ",
    aliasesLabel: (a) => `  (aliases: ${a})`,
    splitLimitNotice: (max) =>
      `Only the first ${max} files were opened. The rest were skipped to avoid too many panes.`,
    cannotOpenSidebar: "Aliases Check: failed to open sidebar panel.",
  },
  zh: {
    viewTitle: "别名检查",
    refreshTooltip: "刷新",
    refreshBtn: "刷新",
    noConflicts: "未发现重复笔记。",
    summaryOne: "发现 1 个冲突组",
    summaryMultiple: (n) => `发现 ${n} 个冲突组`,
    conflictGroup: (i) => `冲突组 ${i}`,
    notesCount: (n) => `(${n} 篇笔记)`,
    compareBtn: "对比",
    conflictNamesLabel: "冲突名称：",
    aliasesLabel: (a) => `  （别名：${a}）`,
    splitLimitNotice: (max) =>
      `仅打开了前 ${max} 个文件，其余已跳过以避免分屏过多。`,
    cannotOpenSidebar: "别名检查：无法打开侧边栏面板。",
  },
};

function getLocale(): Locale {
  const lang = moment.locale();
  return lang.startsWith("zh") ? "zh" : "en";
}

function t(): Translations {
  return TRANSLATIONS[getLocale()];
}

// ---------------------------------------------------------------------------
// Union-Find for grouping conflicting files
// ---------------------------------------------------------------------------
class UnionFind<T> {
  private parent = new Map<T, T>();
  private rank = new Map<T, number>();

  find(x: T): T {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: T, b: T): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra)!;
    const rankB = this.rank.get(rb)!;
    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  groups(): Map<T, T[]> {
    const result = new Map<T, T[]>();
    for (const item of this.parent.keys()) {
      const root = this.find(item);
      if (!result.has(root)) {
        result.set(root, []);
      }
      result.get(root)!.push(item);
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ConflictGroup {
  files: TFile[];
  /** The conflicting names that link these files together */
  conflictNames: string[];
}

// ---------------------------------------------------------------------------
// Sidebar View
// ---------------------------------------------------------------------------
class ConflictView extends ItemView {
  private groups: ConflictGroup[] = [];
  onRefresh?: () => void;

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return t().viewTitle;
  }

  getIcon(): string {
    return "search";
  }

  async onOpen() {
    this.addAction("refresh-cw", t().refreshTooltip, () => {
      this.onRefresh?.();
    });
    this.renderContent();
  }

  async onClose() {
    this.contentEl.empty();
  }

  setGroups(groups: ConflictGroup[]) {
    this.groups = groups;
    this.renderContent();
  }

  private renderContent() {
    const container = this.contentEl;
    container.empty();
    container.addClass("aliases-check-sidebar");
    const l = t();

    // Top refresh button
    const toolbar = container.createDiv({ cls: "aliases-check-toolbar" });
    const refreshBtn = toolbar.createEl("button", {
      text: l.refreshBtn,
      cls: "aliases-check-refresh-btn",
    });
    refreshBtn.addEventListener("click", () => {
      this.onRefresh?.();
    });

    if (this.groups.length === 0) {
      container.createEl("div", {
        text: l.noConflicts,
        cls: "aliases-check-no-conflict",
      });
      return;
    }

    container.createEl("div", {
      text:
        this.groups.length === 1
          ? l.summaryOne
          : l.summaryMultiple(this.groups.length),
      cls: "aliases-check-summary",
    });

    for (let i = 0; i < this.groups.length; i++) {
      const group = this.groups[i];
      const card = container.createDiv({ cls: "aliases-check-card" });

      // Header with Compare button
      const header = card.createDiv({ cls: "aliases-check-card-header" });

      const titleArea = header.createDiv({ cls: "aliases-check-card-title" });
      titleArea.createEl("strong", {
        text: l.conflictGroup(i + 1),
      });
      titleArea.createEl("span", {
        text: ` ${l.notesCount(group.files.length)}`,
        cls: "aliases-check-count",
      });

      const compareBtn = header.createEl("button", {
        text: l.compareBtn,
        cls: "aliases-check-compare-btn",
      });
      compareBtn.addEventListener("click", () => {
        this.openFilesInSplit(group.files);
      });

      // Conflict names as tags
      const tagsEl = card.createDiv({ cls: "aliases-check-tags" });
      tagsEl.createEl("span", { text: l.conflictNamesLabel, cls: "aliases-check-tags-label" });
      for (const name of group.conflictNames) {
        tagsEl.createEl("span", {
          text: name,
          cls: "aliases-check-tag",
        });
      }

      // File list
      const listEl = card.createEl("ul", { cls: "aliases-check-file-list" });
      for (const file of group.files) {
        const li = listEl.createEl("li");

        // Get aliases for display
        const cache = this.app.metadataCache.getFileCache(file);
        const aliases = this.parseAliases(cache?.frontmatter?.aliases);

        const link = li.createEl("a", {
          text: file.path,
          cls: "aliases-check-file-link",
          href: "#",
        });
        link.addEventListener("click", (e) => {
          e.preventDefault();
          this.app.workspace.openLinkText(file.path, "", false);
        });

        if (aliases.length > 0) {
          li.createEl("span", {
            text: l.aliasesLabel(aliases.join(", ")),
            cls: "aliases-check-aliases",
          });
        }
      }
    }
  }

  private async openFilesInSplit(files: TFile[]) {
    if (files.length === 0) return;

    const MAX_SPLITS = 5;
    const filesToOpen = files.slice(0, MAX_SPLITS);

    try {
      // First file: open in the current editor leaf
      const firstLeaf = this.app.workspace.getLeaf(false);
      await firstLeaf.openFile(filesToOpen[0]);

      // Subsequent files: create vertical splits
      for (let i = 1; i < filesToOpen.length; i++) {
        const newLeaf = this.app.workspace.getLeaf("split", "vertical");
        await newLeaf.openFile(filesToOpen[i]);
      }
    } catch (e) {
      console.error("Aliases Check: failed to open files in split", e);
    }

    if (files.length > MAX_SPLITS) {
      new Notice(t().splitLimitNotice(MAX_SPLITS));
    }
  }

  private parseAliases(raw: unknown): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.flatMap((item) =>
        typeof item === "string"
          ? item.split(",").map((s) => s.trim()).filter(Boolean)
          : []
      );
    }
    if (typeof raw === "string") {
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
export default class AliasesCheckPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const view = new ConflictView(leaf);
      view.onRefresh = () => this.activateView();
      return view;
    });

    this.addCommand({
      id: "check-duplicate-aliases",
      name: "Check Duplicate Aliases",
      callback: () => this.activateView(),
    });

    this.addRibbonIcon("search", "Check Duplicate Aliases", () => {
      this.activateView();
    });
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async activateView() {
    const { workspace } = this.app;

    // Reuse existing leaf or create one in the right sidebar
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) {
        new Notice(t().cannotOpenSidebar);
        return;
      }
      await rightLeaf.setViewState({ type: VIEW_TYPE, active: true });
      leaf = rightLeaf;
    }

    workspace.revealLeaf(leaf);

    // Run check and pass results to the view
    const groups = this.findConflicts();
    const view = leaf.view as ConflictView;
    view.setGroups(groups);
  }

  /**
   * Parse aliases from frontmatter.
   * Supports: string[], string (comma-separated), or single string.
   */
  private parseAliases(raw: unknown): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.flatMap((item) =>
        typeof item === "string"
          ? item.split(",").map((s) => s.trim()).filter(Boolean)
          : []
      );
    }
    if (typeof raw === "string") {
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }

  private findConflicts(): ConflictGroup[] {
    const files = this.app.vault.getMarkdownFiles();

    // Map: lowercase name -> list of { file, originalName, source }
    const nameToFiles = new Map<
      string,
      { file: TFile; original: string; source: "filename" | "alias" }[]
    >();

    const addEntry = (
      key: string,
      file: TFile,
      original: string,
      source: "filename" | "alias"
    ) => {
      const lower = key.toLowerCase();
      if (!nameToFiles.has(lower)) {
        nameToFiles.set(lower, []);
      }
      nameToFiles.get(lower)!.push({ file, original, source });
    };

    // Build the map
    for (const file of files) {
      // Add filename (without extension)
      const basename = file.basename;
      addEntry(basename, file, basename, "filename");

      // Add aliases
      const cache = this.app.metadataCache.getFileCache(file);
      const rawAliases = cache?.frontmatter?.aliases;
      const aliases = this.parseAliases(rawAliases);
      for (const alias of aliases) {
        addEntry(alias, file, alias, "alias");
      }
    }

    // Find conflicts: names that map to more than one distinct file
    const uf = new UnionFind<string>(); // keyed by file.path
    // Track which conflict names link which files
    const fileConflictNames = new Map<string, Set<string>>(); // filePath -> set of conflict names

    for (const [name, entries] of nameToFiles.entries()) {
      // Deduplicate by file path
      const uniqueFiles = new Map<string, TFile>();
      for (const e of entries) {
        uniqueFiles.set(e.file.path, e.file);
      }
      if (uniqueFiles.size < 2) continue;

      const paths = [...uniqueFiles.keys()];
      // Union all files that share this name
      for (let i = 1; i < paths.length; i++) {
        uf.union(paths[0], paths[i]);
      }
      // Record the conflict name for each involved file
      for (const p of paths) {
        if (!fileConflictNames.has(p)) {
          fileConflictNames.set(p, new Set());
        }
        // Use the original-case name from the first entry
        const originalName = entries[0].original;
        fileConflictNames.get(p)!.add(originalName);
      }
    }

    // Build groups from Union-Find
    const groups = uf.groups();
    const result: ConflictGroup[] = [];

    // We need a path -> TFile lookup
    const pathToFile = new Map<string, TFile>();
    for (const file of files) {
      pathToFile.set(file.path, file);
    }

    for (const members of groups.values()) {
      if (members.length < 2) continue;

      const groupFiles: TFile[] = [];
      const groupConflictNames = new Set<string>();

      for (const path of members) {
        const file = pathToFile.get(path);
        if (file) groupFiles.push(file);
        const names = fileConflictNames.get(path);
        if (names) {
          for (const n of names) groupConflictNames.add(n);
        }
      }

      if (groupFiles.length >= 2) {
        result.push({
          files: groupFiles.sort((a, b) => a.path.localeCompare(b.path)),
          conflictNames: [...groupConflictNames].sort(),
        });
      }
    }

    return result.sort((a, b) => a.files[0].path.localeCompare(b.files[0].path));
  }
}
