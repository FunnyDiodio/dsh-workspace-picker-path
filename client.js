/**
 * dsh-workspace-picker-path — Client half.
 *
 * Two contributions over one settings store:
 *
 * 1. A General settings row (`settings.general.item`) choosing where the
 *    workspace picker opens: a fixed custom path, or the last directory the
 *    operator confirmed.
 * 2. Occupants of both `ui-workspace` directory-flow holes at priority -2, so
 *    they shadow the shipped pickers (desktop native -1, in-app browse 0) —
 *    `SlotCore.entriesOfSlot` renders the lowest live priority of a single
 *    hole, and upstream's own comment says "register at a different priority
 *    to shadow it". The occupant is an in-app directory browser whose first
 *    listing is requested at the configured start path. That is the only route
 *    a plugin can take: the native OS chooser's start directory is a
 *    main-process decision (`dialog.showOpenDialog` without `defaultPath`)
 *    behind a contextBridge `pick()` that accepts no argument.
 *
 * The owner conversation is honored exactly as upstream's native flow does:
 * one rising `open` edge runs exactly one listing and reports exactly one
 * outcome; an `armed` ref guards re-renders (`busy` flips, handler identity
 * changes, a re-created injected face); a `reported` ref makes double submits
 * impossible; and a settlement arriving after unmount is discarded rather than
 * adopting a path for a dead occupant.
 *
 * Browse and persistence stay inside documented seams: listing/creation
 * through `ctx.uiWorkspace`, preferences through this bundle's own same-origin
 * host route. No host package is required as a module; controls and styles are
 * this plugin's own, themed only through --dsw-alias-* tokens.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-picker-path',
  factory(require) {
    const React = require('react');
    // createPortal: the flow seat lives deep inside the sidebar, so the dialog
    // is mounted on document.body (the host's own Modal does the same) to stay
    // clear of any ancestor transform/overflow that would clip a fixed layer.
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    const NS = 'workspace-picker-path';
    const ROUTE = '/workspace-picker-path/api/settings';
    /** Drive roots for the picker's "This PC" level (Windows only). */
    const DRIVES_ROUTE = '/workspace-picker-path/api/drives';
    const CSS_PREFIX = 'wpPath';
    /** Both holes the workspace owner declares; registered as one effect pair. */
    const FLOW_HOLES = ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow'];
    const DEFAULT_SETTINGS = { mode: 'custom', customPath: '', lastPath: '' };

    const DICTS = {
      zh: {
        'settings.title': '新建工作区弹窗起始路径',
        'settings.desc': '点击“添加工作区”时，目录选择框从哪里打开。',
        'settings.mode.custom': '自定义路径',
        'settings.mode.remember': '记住上次选择',
        'settings.custom.placeholder': '例如 D:\\Projects',
        'settings.custom.help': '弹窗每次从该目录打开；留空或路径无效时退回主目录。',
        'settings.remember.help': '弹窗打开在你上次点击“打开”确认的目录；取消或首启未记录时退回主目录。',
        'settings.last.none': '尚未记录：首次打开将从主目录开始。',
        'settings.last.value': '上次确认的目录：{path}',
        'dialog.title': '选择工作区目录',
        'dialog.home': '主目录',
        'dialog.open': '打开',
        'dialog.cancel': '取消',
        'dialog.newFolder': '新建文件夹',
        'dialog.folderName': '文件夹名称',
        'dialog.create': '创建',
        'dialog.cancelCreate': '取消新建',
        'dialog.createIn': '在“{name}”中新建文件夹',
        'dialog.loading': '加载中…',
        'dialog.empty': '此目录没有子文件夹。',
        'dialog.truncated': '文件夹过多，仅显示开头部分。',
        'dialog.showHidden': '显示隐藏文件',
        'dialog.editPath': '输入完整路径后按回车跳转',
        'dialog.fallback': '无法打开“{path}”，已改从主目录开始。',
        'dialog.up': '上一层',
        'dialog.level': '当前目录',
        'dialog.thisPc': '此电脑',
        'dialog.drive': '本地磁盘',
        'dialog.noDrives': '未发现可用的驱动器。',
        'settings.save': '保存',
        'settings.saving': '正在保存…',
        'settings.browse': '浏览…',
        'settings.browseTitle': '选择起始路径',
        'settings.browsePick': '选定此目录',
      },
      en: {
        'settings.title': 'Workspace picker start path',
        'settings.desc': 'Where the directory chooser opens when you click Add workspace.',
        'settings.mode.custom': 'Custom path',
        'settings.mode.remember': 'Remember last pick',
        'settings.custom.placeholder': 'e.g. C:\\Projects',
        'settings.custom.help': 'The picker opens there every time; an empty or unreadable path falls back to your home directory.',
        'settings.remember.help': 'The picker opens in the directory you last confirmed with “Open”; cancelling or a first run falls back to your home directory.',
        'settings.last.none': 'Nothing recorded yet: the first open starts in your home directory.',
        'settings.last.value': 'Last confirmed directory: {path}',
        'dialog.title': 'Select Workspace Directory',
        'dialog.home': 'Home',
        'dialog.open': 'Open',
        'dialog.cancel': 'Cancel',
        'dialog.newFolder': 'New folder',
        'dialog.folderName': 'Folder name',
        'dialog.create': 'Create',
        'dialog.cancelCreate': 'Cancel',
        'dialog.createIn': 'New folder in "{name}"',
        'dialog.loading': 'Loading…',
        'dialog.empty': 'No folders here.',
        'dialog.truncated': 'Too many folders to list; only the beginning is shown.',
        'dialog.showHidden': 'Show hidden files',
        'dialog.editPath': 'Type a full path and press Enter to jump',
        'dialog.fallback': 'Could not open "{path}"; started in your home directory instead.',
        'dialog.up': 'Up one level',
        'dialog.level': 'Current directory',
        'dialog.thisPc': 'This PC',
        'dialog.drive': 'Local Disk',
        'dialog.noDrives': 'No usable drives were found.',
        'settings.save': 'Save',
        'settings.saving': 'Saving…',
        'settings.browse': 'Browse…',
        'settings.browseTitle': 'Choose the start path',
        'settings.browsePick': 'Use this folder',
      },
    };

    /** The locale face captured in apply; dictionaries below. */
    let localeService = null;

    /**
     * Translate one key with {placeholder} interpolation. The active locale
     * comes from the DSH locale service when available (the host preference
     * wins over the browser language and switches live); the zh branch covers
     * every zh-* id.
     */
    function t(key, params) {
      let active = 'en';
      try {
        active = localeService?.getSnapshot().active ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
      } catch {
        active = typeof navigator !== 'undefined' ? navigator.language : 'en';
      }
      const dict = String(active).toLowerCase().startsWith('zh') ? DICTS.zh : DICTS.en;
      let text = dict[key] ?? DICTS.en[key];
      if (text === undefined) return key;
      if (params !== undefined) {
        for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
      }
      return text;
    }

    function createStore(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => value,
        set(next) {
          value = next;
          for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }

    /** Created in apply, before any registration renders. */
    let settingsStore = null;

    async function fetchSettings() {
      const response = await fetch(ROUTE, { cache: 'no-store' });
      const body = await response.json().catch(() => undefined);
      if (!response.ok || body?.ok !== true) throw new Error(`settings read failed (HTTP ${String(response.status)})`);
      return body.settings;
    }

    /**
     * Publish one optimistic field and persist it. A rejection restores the
     * previous snapshot, so a failed save never leaves the row lying.
     */
    async function patchSettings(patch) {
      const previous = settingsStore.getSnapshot();
      settingsStore.set({ ...previous, ...patch });
      try {
        const response = await fetch(ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ patch }),
        });
        const body = await response.json().catch(() => undefined);
        if (!response.ok || body?.ok !== true) throw new Error(typeof body?.message === 'string' ? body.message : `HTTP ${String(response.status)}`);
        settingsStore.set(body.settings);
        return body.settings;
      } catch (error) {
        settingsStore.set(previous);
        throw error;
      }
    }

    /**
     * Normalize one path the operator pasted. Windows Explorer's "copy path"
     * hands back the value wrapped in double quotes ("D:\\SORTS\\…"), so a
     * quoted path must read the same as an unquoted one instead of failing the
     * listing and falling back home. Tolerates double/single quotes and trims
     * surrounding whitespace.
     */
    function normalizePath(raw) {
      if (typeof raw !== 'string') return '';
      let text = raw.trim();
      const pairs = [['"', '"'], ["'", "'"], ['“', '”'], ['「', '」']];
      for (const [open, close] of pairs) {
        if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
          text = text.slice(1, -1).trim();
          break;
        }
      }
      return text;
    }

    /**
     * Pseudo-path for the "This PC" level. Windows drive roots are siblings
     * (`D:\` is not under `C:\Users\…`), so the breadcrumb walk can never
     * reach another volume; this level lists drive roots instead, the way the
     * native chooser's "此电脑" node does.
     */
    const THIS_PC = '::this-pc';
    /**
     * The mounted drive roots for the "This PC" level.
     *
     * Deliberately NOT cached: a volume plugged in after boot (a USB disk, a
     * mapped share) has to appear the next time the operator opens this level,
     * and the probe costs single-digit milliseconds, so a cache would buy
     * nothing and could only go stale.
     */
    async function fetchDrives() {
      const response = await fetch(DRIVES_ROUTE, { cache: 'no-store' });
      const body = await response.json().catch(() => undefined);
      if (!response.ok || body?.ok !== true) throw new Error(`drives listing failed (HTTP ${String(response.status)})`);
      return Array.isArray(body.drives) ? body.drives : [];
    }

    // ── Path helpers (the host resolves paths; the client never joins them) ──

    /**
     * The listing's platform separator, inferred from the host-stamped home —
     * the shipped browse dialog's own heuristic: on Windows a forward slash
     * separates too, on POSIX a backslash is a legal name character.
     */
    function separatorOf(listing) {
      return typeof listing?.home === 'string' && listing.home.includes('\\') ? '\\' : '/';
    }

    /**
     * Parent of one absolute path, or null when it has no listable parent
     * (POSIX root, or a bare Windows drive root). '/home' → '/', 'D:\\' → null,
     * 'D:\\Projects' → 'D:\\'.
     */
    function parentOf(path, sep) {
      const trimmed = String(path).replace(/[\\/]+$/, '');
      const cut = trimmed.lastIndexOf(sep);
      if (cut < 0) return null;
      const head = trimmed.slice(0, cut);
      if (sep === '\\') {
        if (/^[A-Za-z]:$/.test(head)) return `${head}\\`;
        return head === '' ? null : head;
      }
      return head === '' ? '/' : head;
    }

    /** Breadcrumb rows: inside the home subtree, root at a localized Home crumb. */
    function displayCrumbs(listing, homeLabel) {
      const crumbs = Array.isArray(listing?.crumbs) ? listing.crumbs : [];
      const homeIndex = crumbs.findIndex((crumb) => crumb.path === listing.home);
      if (homeIndex === -1) return crumbs;
      return [{ name: homeLabel, path: listing.home, hidden: false }, ...crumbs.slice(homeIndex + 1)];
    }

    // ── The General settings row ───────────────────────────
    // Two modes only, so the choice is a segmented control rendered in place
    // rather than a dropdown. A menu either rides inside the settings panel's
    // scroll container (and gets clipped) or has to be portalled and out-stack
    // the host's own modal layer — neither is verifiable from a plugin, and the
    // bug this replaces was exactly a menu that opened invisibly. Two visible
    // segments cannot fail that way and hide nothing.
    // Rows follow the host's rhythm (PreferenceRow is a flex line with a bottom
    // border; the section strips the last one): the chooser, then the field the
    // chosen mode owns.
    function SettingsRow({ useSettings, listDirectory, createDirectory }) {
      if (typeof useSettings !== 'function') return null;
      const settings = useSettings((value) => value);
      const [draft, setDraft] = React.useState(settings.customPath);
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState(null);
      /** True while the visual directory chooser is open over the panel. */
      const [browsing, setBrowsing] = React.useState(false);

      // Follow durable changes: the boot GET, or another window saving.
      React.useEffect(() => {
        setDraft(settings.customPath);
      }, [settings.customPath]);

      const save = (patch) => {
        setBusy(true);
        setNotice(null);
        patchSettings(patch).then(
          () => setBusy(false),
          (error) => {
            setBusy(false);
            setNotice(error instanceof Error ? error.message : String(error));
          },
        );
      };

      const pickMode = (mode) => {
        if (mode !== settings.mode) save({ mode });
      };

      const commitPath = () => {
        // Compare and save the NORMALIZED text: Explorer's "copy path" arrives
        // quoted, and a quoted value must not look "changed" forever.
        const next = normalizePath(draft);
        if (next === settings.customPath) {
          if (next !== draft) setDraft(next);
          return;
        }
        save({ customPath: next });
      };

      return h(React.Fragment, null,
        h('div', { className: `${CSS_PREFIX}__row` },
          h('div', { className: `${CSS_PREFIX}__rowText` },
            h('div', { className: `${CSS_PREFIX}__title` }, t('settings.title')),
            h('div', { className: `${CSS_PREFIX}__desc` }, t('settings.desc')),
          ),
          h('div', {
            className: `${CSS_PREFIX}__segment`,
            role: 'radiogroup',
            'aria-label': t('settings.title'),
          },
            ['custom', 'remember'].map((mode) => h('button', {
              key: mode,
              type: 'button',
              role: 'radio',
              'aria-checked': settings.mode === mode,
              disabled: busy,
              className: `${CSS_PREFIX}__segmentItem${settings.mode === mode ? ` ${CSS_PREFIX}__segmentItemOn` : ''}`,
              onClick: () => pickMode(mode),
            }, t(`settings.mode.${mode}`))),
          ),
        ),
        h('div', { className: `${CSS_PREFIX}__row ${CSS_PREFIX}__rowField` },
          settings.mode === 'custom'
            ? h(React.Fragment, null,
              h('input', {
                type: 'text',
                className: `${CSS_PREFIX}__pathInput`,
                value: draft,
                placeholder: t('settings.custom.placeholder'),
                spellCheck: false,
                autoComplete: 'off',
                disabled: busy,
                'aria-label': t('settings.title'),
                onChange: (event) => setDraft(event.target.value),
                onBlur: commitPath,
                onKeyDown: (event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  commitPath();
                },
              }),
              h('button', {
                type: 'button',
                className: `${CSS_PREFIX}__btn ${CSS_PREFIX}__btnOutline`,
                disabled: busy || normalizePath(draft) === settings.customPath,
                onClick: commitPath,
              }, busy ? t('settings.saving') : t('settings.save')),
              // Visual picking needs a directory backend; without one (a
              // composition that serves no browse capability) the row stays
              // paste-and-type only rather than opening a dead button.
              typeof listDirectory === 'function' && typeof createDirectory === 'function'
                ? h('button', {
                  type: 'button',
                  className: `${CSS_PREFIX}__btn ${CSS_PREFIX}__btnOutline ${CSS_PREFIX}__btnBrowse}`,
                  disabled: busy,
                  title: t('settings.browse'),
                  onClick: () => setBrowsing(true),
                }, h(BrowseIcon), h('span', null, t('settings.browse')))
                : null,
            )
            : h('div', { className: `${CSS_PREFIX}__hint ${CSS_PREFIX}__hintGrow` },
              settings.lastPath ? t('settings.last.value', { path: settings.lastPath }) : t('settings.last.none')),
        ),
        h('div', { className: `${CSS_PREFIX}__row ${CSS_PREFIX}__rowNote` },
          notice !== null
            ? h('div', { className: `${CSS_PREFIX}__error`, role: 'alert' }, notice)
            : h('div', { className: `${CSS_PREFIX}__hint` },
              t(settings.mode === 'custom' ? 'settings.custom.help' : 'settings.remember.help')),
        ),
        // The same browser the workspace flow runs, here choosing the start
        // path itself: it opens at the current value and a pick writes back.
        browsing ? h(DirectoryBrowser, {
          open: true,
          adopting: false,
          listDirectory,
          createDirectory,
          title: t('settings.browseTitle'),
          confirmLabel: t('settings.browsePick'),
          startPath: () => settings.customPath,
          onPicked: (path) => {
            setBrowsing(false);
            setDraft(path);
            if (path !== settings.customPath) save({ customPath: path });
          },
          onCancel: () => setBrowsing(false),
        }) : null,
      );
    }

    // ── The shared directory browser ───────────────────────────────────────
    /**
     * One dialog, two callers: the workspace flow holes (adopt a directory as
     * a new Workspace) and the settings row's "browse" button (choose the
     * start path itself). Behavior differs only through props — start path,
     * title, confirm label, and whether a pick records the "remember" memory.
     */
    function DirectoryBrowser(props) {
      const { open, adopting, listDirectory, createDirectory } = props;

      const [level, setLevel] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [showHidden, setShowHidden] = React.useState(false);
      const [pathDraft, setPathDraft] = React.useState('');
      const [creating, setCreating] = React.useState(false);
      const [folderName, setFolderName] = React.useState('');
      const [createBusy, setCreateBusy] = React.useState(false);
      const [armed, setArmed] = React.useState(false);
      /** Non-null while showing the synthesized "This PC" drive-root level. */
      const [drives, setDrives] = React.useState(null);

      // Latest owner handlers, and the alive flag: a settlement that arrives
      // after unmount is discarded wholesale rather than adopting a path for a
      // dead occupant.
      const outcome = React.useRef(props);
      outcome.current = props;
      const alive = React.useRef(true);
      React.useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
      }, []);
      const generation = React.useRef(0);
      const controller = React.useRef(null);
      /** Exactly one reported outcome per open edge. */
      const reported = React.useRef(false);

      const listRef = React.useRef(listDirectory);
      listRef.current = listDirectory;
      const createRef = React.useRef(createDirectory);
      createRef.current = createDirectory;

      /**
       * List one level. A start that cannot be read falls back to the host
       * home and says so in-dialog — browse failures stay inside this dialog's
       * own alert surface, so the owner's `onError` arm is never driven by a
       * navigation the operator can still recover from.
       * @param path - absolute directory, THIS_PC, or undefined for the home.
       */
      const go = (path) => {
        const gen = ++generation.current;
        controller.current?.abort();
        const abort = new AbortController();
        controller.current = abort;
        setLoading(true);
        setError(null);
        setNotice(null);
        const signal = abort.signal;
        if (path === THIS_PC) {
          // The drive-root level is synthesized here, not listed by the host:
          // it has no real path, so crumbs and the path bar carry the label.
          Promise.resolve()
            .then(() => fetchDrives())
            .then((drives) => {
              if (gen !== generation.current || !alive.current) return;
              setLevel(null);
              setDrives(drives);
              setPathDraft(t('dialog.thisPc'));
              setShowHidden(false);
              setCreating(false);
              setFolderName('');
              setCreateBusy(false);
              setLoading(false);
            }, (reason) => {
              if (gen !== generation.current || !alive.current) return;
              setDrives(null);
              setError(reason instanceof Error ? reason.message : String(reason));
              setLoading(false);
            });
          return;
        }
        setDrives(null);
        Promise.resolve()
          .then(() => listRef.current(path, signal))
          .then((listing) => {
            if (gen !== generation.current || !alive.current) return;
            setLevel(listing);
            setPathDraft(listing.path);
            setShowHidden(false);
            setCreating(false);
            setFolderName('');
            setCreateBusy(false);
            setLoading(false);
          }, (firstReason) => {
            if (gen !== generation.current || !alive.current) return;
            if (path === undefined) {
              setLevel(null);
              setError(firstReason instanceof Error ? firstReason.message : String(firstReason));
              setLoading(false);
              return;
            }
            // The configured start is unreadable: retry at the host home and
            // keep the operator informed of what was substituted.
            Promise.resolve()
              .then(() => listRef.current(undefined, signal))
              .then((listing) => {
                if (gen !== generation.current || !alive.current) return;
                setLevel(listing);
                setPathDraft(listing.path);
                setShowHidden(false);
                setNotice(t('dialog.fallback', { path: String(path) }));
                setLoading(false);
              }, (secondReason) => {
                if (gen !== generation.current || !alive.current) return;
                setLevel(null);
                setError(secondReason instanceof Error ? secondReason.message : String(secondReason));
                setLoading(false);
              });
          });
      };

      // One rising `open` edge runs exactly one listing. The owner withdrawing
      // `open` re-arms the next request.
      React.useEffect(() => {
        if (!open) {
          setArmed(false);
          return;
        }
        if (armed) return;
        setArmed(true);
        reported.current = false;
        // Normalize again on read: a value stored before quoting was tolerated
        // (or hand-edited into the file) must still open where it says.
        const start = normalizePath(typeof props.startPath === 'function' ? props.startPath() : (props.startPath ?? ''));
        go(start === '' ? undefined : start);
        // `armed` is deliberately the only trigger here.
      }, [open, armed]);

      // A close discards whatever is in flight.
      React.useEffect(() => {
        if (open) return;
        generation.current += 1;
        controller.current?.abort();
        setLoading(false);
        setError(null);
        setNotice(null);
        reported.current = false;
      }, [open]);

      const cancel = React.useCallback(() => {
        if (!alive.current || reported.current || outcome.current.adopting) return;
        reported.current = true;
        outcome.current.onCancel();
      }, []);

      const pick = React.useCallback((path) => {
        if (!alive.current || reported.current || path === null || path === undefined) return;
        if (outcome.current.adopting) return;
        // Only the workspace flow records a memory: the settings row that
        // configures the start path must not overwrite the value it shows.
        if (outcome.current.rememberPick === true) {
          const settings = settingsStore.getSnapshot();
          // Record the confirmed directory before handing it to the owner: "last
          // successfully picked" means the directory just confirmed, and a
          // workspace-create refusal afterwards must not erase it.
          if (settings.mode === 'remember' && settings.lastPath !== path) {
            patchSettings({ lastPath: path }).catch(() => {});
          }
        }
        reported.current = true;
        outcome.current.onPicked(path);
      }, []);

      const createFolder = () => {
        const name = folderName.trim();
        const target = level?.path;
        if (name === '' || target === undefined || createBusy || adopting) return;
        setCreateBusy(true);
        setError(null);
        Promise.resolve()
          .then(() => createRef.current(target, name))
          .then((created) => {
            setCreateBusy(false);
            setCreating(false);
            setFolderName('');
            go(created);
          }, (reason) => {
            setCreateBusy(false);
            setError(reason instanceof Error ? reason.message : String(reason));
          });
      };

      // Escape closes the dialog from anywhere while it is open (the dialog
      // card only sees the key when focus is inside it).
      React.useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          if (creating) {
            setCreating(false);
            setFolderName('');
            return;
          }
          cancel();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
      }, [open, creating, cancel]);

      if (!open) return null;

      const atThisPc = drives !== null;
      const sep = level === null ? '/' : separatorOf(level);
      const onWindows = sep === '\\';
      /**
       * The Windows volume roots: a bare drive (`D:\`) or a UNC share
       * (`\\server\share`). Both are the top of their own tree — the host
       * refuses the parent forms (`D:`, `\\server`) as not fully qualified —
       * so "up" from one lands on This PC rather than on an unreadable path.
       */
      const isVolumeRoot = (value) => /^[A-Za-z]:[\\/]$/.test(String(value))
        || /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+[\\/]*$/.test(String(value));
      const inert = adopting === true || loading || createBusy;
      const rows = level === null ? [] : level.entries.filter((entry) => showHidden || entry.hidden !== true);
      const upFrom = atThisPc || level === null
        ? null
        : (isVolumeRoot(level.path) ? THIS_PC : parentOf(level.path, sep));
      const crumbs = atThisPc
        ? [{ name: t('dialog.thisPc'), path: THIS_PC, hidden: false }]
        : level === null ? [] : displayCrumbs(level, t('dialog.home'));
      // Windows volumes are siblings, so "This PC" joins the trail as the one
      // hop that reaches another drive from anywhere in one click.
      const trail = onWindows && !atThisPc
        ? [{ name: t('dialog.thisPc'), path: THIS_PC, hidden: false }, ...crumbs]
        : crumbs;
      const levelName = trail.length === 0 ? '' : String(trail.at(-1)?.name ?? '');
      const canOpen = level !== null && !inert;

      // Mount on the document root (see the createPortal note above). Without
      // a body (SSR / tests) render inline rather than throwing.
      const host = typeof document === 'undefined' ? null : document.body;
      const overlay = h('div', { className: `${CSS_PREFIX}__modalRoot` },
        h('div', { className: `${CSS_PREFIX}__mask`, onClick: cancel, 'aria-hidden': true }),
        h('div', {
          className: `${CSS_PREFIX}__dialog`,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': props.title ?? t('dialog.title'),
          tabIndex: -1,
        },
          h('div', { className: `${CSS_PREFIX}__header` },
            h('div', { className: `${CSS_PREFIX}__titleBar` },
              h('h2', { className: `${CSS_PREFIX}__title` }, props.title ?? t('dialog.title')),
              h('button', {
                type: 'button',
                className: `${CSS_PREFIX}__close`,
                'aria-label': t('dialog.cancel'),
                disabled: adopting === true,
                onClick: cancel,
              }, '✕'),
            ),
            h('div', { className: `${CSS_PREFIX}__crumbs` },
              h('button', {
                type: 'button',
                className: `${CSS_PREFIX}__iconBtn`,
                disabled: inert || upFrom === null,
                'aria-label': t('dialog.up'),
                title: t('dialog.up'),
                onClick: () => { if (upFrom !== null) go(upFrom); },
              }, '↑'),
              trail.map((crumb, index) => h(React.Fragment, { key: `${crumb.path}#${index}` },
                index > 0 ? h('span', { className: `${CSS_PREFIX}__crumbSep`, 'aria-hidden': true }, '›') : null,
                h('button', {
                  type: 'button',
                  className: `${CSS_PREFIX}__crumb${index === trail.length - 1 ? ` ${CSS_PREFIX}__crumbCurrent` : ''}`,
                  disabled: inert,
                  onClick: () => go(crumb.path),
                }, crumb.name),
              )),
            ),
            h('input', {
              type: 'text',
              className: `${CSS_PREFIX}__pathBar`,
              value: pathDraft,
              'aria-label': t('dialog.level'),
              placeholder: t('dialog.editPath'),
              spellCheck: false,
              autoComplete: 'off',
              disabled: inert,
              onChange: (event) => setPathDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const next = normalizePath(pathDraft);
                // The bar carries the "This PC" label, which is not a path:
                // Enter on the untouched label is a no-op, while any edited
                // text navigates (and a bad one falls back home with a note).
                if (next === '' || (atThisPc && next === pathDraft)) return;
                go(next);
              },
            }),
          ),
          h('div', { className: `${CSS_PREFIX}__body` },
            loading ? h('div', { className: `${CSS_PREFIX}__status`, role: 'status' }, t('dialog.loading')) : null,
            error !== null ? h('div', { className: `${CSS_PREFIX}__error`, role: 'alert' }, error) : null,
            notice !== null ? h('div', { className: `${CSS_PREFIX}__notice`, role: 'status' }, notice) : null,
            !loading && !atThisPc && level !== null && error === null && rows.length === 0
              ? h('div', { className: `${CSS_PREFIX}__status` }, t('dialog.empty'))
              : null,
            atThisPc ? h('div', { className: `${CSS_PREFIX}__list`, role: 'listbox', 'aria-label': t('dialog.thisPc') },
              (drives ?? []).map((drive) => h('button', {
                key: drive.path,
                type: 'button',
                role: 'option',
                className: `${CSS_PREFIX}__item`,
                disabled: inert,
                onClick: () => go(drive.path),
              },
                h('span', { className: `${CSS_PREFIX}__itemIcon`, 'aria-hidden': true }, h(DriveIcon)),
                h('span', { className: `${CSS_PREFIX}__itemName` }, `${drive.name} ${t('dialog.drive')}`),
              )),
              (drives ?? []).length === 0 && !loading ? h('div', { className: `${CSS_PREFIX}__status` }, t('dialog.noDrives')) : null,
            ) : level !== null ? h('div', { className: `${CSS_PREFIX}__list`, role: 'listbox', 'aria-label': level.path },
              rows.map((entry) => h('button', {
                key: entry.path,
                type: 'button',
                role: 'option',
                className: `${CSS_PREFIX}__item${entry.hidden ? ` ${CSS_PREFIX}__itemDim` : ''}`,
                disabled: inert,
                onClick: () => go(entry.path),
              },
                h('span', { className: `${CSS_PREFIX}__itemIcon`, 'aria-hidden': true }, h(FolderIcon)),
                h('span', { className: `${CSS_PREFIX}__itemName` }, entry.name),
              )),
              level.truncated === true ? h('div', { className: `${CSS_PREFIX}__status` }, t('dialog.truncated')) : null,
            ) : null,
            creating ? h('div', { className: `${CSS_PREFIX}__create` },
              h('div', { className: `${CSS_PREFIX}__createLabel` }, t('dialog.createIn', { name: levelName })),
              h('input', {
                type: 'text',
                className: `${CSS_PREFIX}__createInput`,
                value: folderName,
                placeholder: t('dialog.folderName'),
                autoFocus: true,
                disabled: inert,
                onChange: (event) => setFolderName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    createFolder();
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setCreating(false);
                    setFolderName('');
                  }
                },
              }),
              h('div', { className: `${CSS_PREFIX}__createActions` },
                h('button', {
                  type: 'button',
                  className: `${CSS_PREFIX}__btn ${CSS_PREFIX}__btnOutline`,
                  disabled: createBusy || adopting === true,
                  onClick: () => { setCreating(false); setFolderName(''); },
                }, t('dialog.cancelCreate')),
                h('button', {
                  type: 'button',
                  className: `${CSS_PREFIX}__btn ${CSS_PREFIX}__btnPrimary`,
                  disabled: createBusy || adopting === true || folderName.trim() === '' || level === null,
                  onClick: createFolder,
                }, createBusy ? t('settings.saving') : t('dialog.create')),
              ),
            ) : null,
          ),
          h('div', { className: `${CSS_PREFIX}__footer` },
            level === null ? null : h('label', { className: `${CSS_PREFIX}__toggle` },
              h('input', {
                type: 'checkbox',
                checked: showHidden,
                disabled: inert,
                onChange: (event) => setShowHidden(event.target.checked),
              }),
              h('span', null, t('dialog.showHidden')),
            ),
            h('span', { className: `${CSS_PREFIX}__footerGap` }),
            h('button', {
              type: 'button',
              className: `${CSS_PREFIX}__btn ${CSS_PREFIX}__btnOutline`,
              disabled: inert || atThisPc,
              onClick: () => setCreating(true),
            }, t('dialog.newFolder')),
            h('button', {
              type: 'button',
              className: `${CSS_PREFIX}__btn ${CSS_PREFIX}__btnOutline`,
              disabled: adopting === true,
              onClick: cancel,
            }, t('dialog.cancel')),
            h('button', {
              type: 'button',
              className: `${CSS_PREFIX}__btn ${CSS_PREFIX}__btnPrimary`,
              disabled: !canOpen,
              onClick: () => pick(level.path),
            }, props.confirmLabel ?? t('dialog.open')),
          ),
        ),
      );
      return host === null ? overlay : ReactDOM.createPortal(overlay, host);
    }

    /**
     * The directory-flow occupant: adapts the hole owner's conversation onto
     * the shared browser. A confirmed directory is the picked path, dismissal
     * is the cancellation; browse failures stay inside the dialog's own alert
     * surfaces, so the owner's `onError` arm is never driven by this occupant.
     * @param props - the owner conversation plus the injected browse calls.
     * @returns the dialog element (renders nothing while closed).
     */
    function WorkspaceDirectoryFlow(props) {
      return h(DirectoryBrowser, {
        open: props.open,
        adopting: props.busy,
        listDirectory: props.listDirectory,
        createDirectory: props.createDirectory,
        rememberPick: true,
        // A getter, not a value: the browser reads it on its own open edge, so
        // a settings change that re-renders this occupant can never reseed an
        // in-flight listing or race the armed guard.
        startPath: () => {
          const settings = settingsStore.getSnapshot();
          return settings.mode === 'remember' ? settings.lastPath : settings.customPath;
        },
        onPicked: props.onPicked,
        onCancel: props.onCancel,
      });
    }

    /** 14px folder-with-arrow glyph for the "browse" button. */
    function BrowseIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
        h('path', {
          d: 'M1.75 3.5c0-.55.45-1 1-1H6l1.25 1.5h5c.55 0 1 .45 1 1v7c0 .55-.45 1-1 1h-11.5c-.55 0-1-.45-1-1v-8.5Z',
          fill: 'currentColor',
          opacity: .55,
        }),
        h('path', {
          d: 'M7.5 8.25h4.75l-1.6-1.6.9-.9L15 8.75 11.55 12.25l-.9-.9 1.6-1.6H7.5v-1.6Z',
          fill: 'currentColor',
        }));
    }

    /** 14px drive glyph for the "This PC" volume rows. */
    function DriveIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true,
        style: { display: 'block' },
      },
        h('path', {
          d: 'M2.5 4.5c0-.83.67-1.5 1.5-1.5h8c.83 0 1.5.67 1.5 1.5v4.25h-11V4.5Zm0 6.25h11v.75c0 .83-.67 1.5-1.5 1.5H4c-.83 0-1.5-.67-1.5-1.5v-.75Zm8.75-3.5a.875.875 0 1 1-1.75 0 .875.875 0 0 1 1.75 0Z',
          fill: 'currentColor',
        }));
    }

    /** 14px folder glyph, sized to the host's row icons. */
    function FolderIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true,
        style: { display: 'block' },
      },
        h('path', {
          d: 'M1.75 3.5c0-.55.45-1 1-1H6l1.25 1.5h5c.55 0 1 .45 1 1v7c0 .55-.45 1-1 1h-11.5c-.55 0-1-.45-1-1v-8.5Z',
          fill: 'currentColor',
        }));
    }

    const CSS = `
/* Every element this plugin owns measures its padding and border INSIDE its
   width. The host's own reset does not reach these nodes, and a width:100%
   input under content-box spills past the dialog edge. */
[class^="${CSS_PREFIX}__"], [class*=" ${CSS_PREFIX}__"] { box-sizing: border-box; }

/* ── General rows: host PreferenceRow metrics (flex line, hairline divider) ── */
.${CSS_PREFIX}__row {
  border-bottom: .5px solid var(--dsw-alias-border-l2);
  align-items: center;
  gap: 8px;
  padding: 16px 0;
  display: flex;
}
.${CSS_PREFIX}__rowField { padding: 2px 0 12px; }
.${CSS_PREFIX}__rowNote { padding: 0 0 16px; align-items: flex-start; }
.${CSS_PREFIX}__rowText { flex-direction: column; flex: 1; gap: 4px; min-width: 0; padding-right: 48px; display: flex; }
.${CSS_PREFIX}__title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 400; line-height: 22px; }
.${CSS_PREFIX}__desc { color: var(--dsw-alias-label-tertiary); font-size: 12px; font-weight: 400; line-height: 18px; }
.${CSS_PREFIX}__segment {
  /* In-place segmented control: two visible choices, no overlay to stack.
     Track is an alpha wash (safe on either panel surface); the selected chip
     uses the popover surface token, which is raised above its background in
     BOTH light and dark by definition — bg-layer-2 would have read darker
     than the track in dark theme. */
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-alias-interactive-bg-hover);
  border: .5px solid var(--dsw-alias-border-l2);
  align-items: stretch;
  gap: 2px;
  padding: 2px;
  display: inline-flex;
  flex: none;
}
.${CSS_PREFIX}__segmentItem {
  border-radius: var(--dsw-radius-md, 8px);
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  background: 0 0;
  border: none;
  padding: 6px 14px;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
}
.${CSS_PREFIX}__segmentItem:hover:not(:disabled):not(.${CSS_PREFIX}__segmentItemOn) { color: var(--dsw-alias-label-primary); }
.${CSS_PREFIX}__segmentItem:disabled { cursor: default; opacity: .45; }
.${CSS_PREFIX}__segmentItemOn {
  /* bg-overlay is the popover surface: lighter than its own background in
     BOTH themes (bluish-150 on white, bluish-700 on the dark base), so the
     selected chip always reads raised. layer-N tokens invert in dark. */
  background: var(--dsw-alias-bg-overlay, #e9ecf2);
  color: var(--dsw-alias-label-primary);
  font-weight: 510;
  box-shadow: 0 1px 3px rgb(0 0 0 / 18%);
}
.${CSS_PREFIX}__pathInput {
  border-radius: var(--dsw-radius-md, 8px);
  color: var(--dsw-alias-label-primary);
  border: .5px solid var(--dsw-alias-border-l4);
  background: transparent;
  flex: 1 1 auto;
  outline: none;
  padding: 6px 10px;
  font-size: 13px;
  line-height: 20px;
  min-width: 0;
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
.${CSS_PREFIX}__pathInput:focus-visible { border-color: var(--dsw-alias-border-focus, var(--dsw-alias-button-info-fill, #247bbf)); }
.${CSS_PREFIX}__hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.${CSS_PREFIX}__hintGrow { flex: 1 1 auto; }
.${CSS_PREFIX}__error { color: var(--dsw-alias-state-error-primary, #e5484d); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.${CSS_PREFIX}__btn {
  cursor: pointer;
  border-radius: var(--dsw-radius-md, 8px);
  border: none;
  padding: 6px 14px;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  flex: none;
}
.${CSS_PREFIX}__btn:disabled { cursor: not-allowed; opacity: .4; }
.${CSS_PREFIX}__btnOutline { border: .5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); }
.${CSS_PREFIX}__btnOutline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.${CSS_PREFIX}__btnPrimary { background: var(--dsw-alias-button-info-fill, var(--dsw-alias-accent, #247bbf)); color: #fff; }
.${CSS_PREFIX}__btnPrimary:hover:not(:disabled) { filter: brightness(1.06); }
/* The browse button carries a glyph beside its label. */
.${CSS_PREFIX}__btnBrowse { align-items: center; gap: 6px; display: inline-flex; }
.${CSS_PREFIX}__modalRoot { position: fixed; inset: 0; z-index: 1300; display: flex; align-items: center; justify-content: center; }
.${CSS_PREFIX}__mask { background: rgb(0 0 0 / 45%); position: absolute; inset: 0; }
.${CSS_PREFIX}__dialog {
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  border-radius: var(--dsw-radius-xl, 14px);
  /* bg-base is the darkest app surface (deep-theme neutral-bluish-950) and the
     same white as layer-2 in light theme, so the dialog reads one step darker
     and deeper than the grey panels instead of matching them. */
  background: var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-2, #fff));
  border: .5px solid var(--dsw-alias-border-l2);
  flex-direction: column;
  flex: none;
  width: min(680px, 100% - 32px);
  height: min(500px, 100dvh - 32px);
  display: flex;
  position: relative;
  overflow: hidden;
  box-shadow: 0 24px 64px rgb(0 0 0 / 45%);
}
.${CSS_PREFIX}__header { flex-direction: column; flex: none; gap: 8px; padding: 14px 16px 10px; display: flex; border-bottom: .5px solid var(--dsw-alias-border-l3); }
.${CSS_PREFIX}__titleBar { align-items: center; justify-content: space-between; display: flex; }
.${CSS_PREFIX}__title { color: var(--dsw-alias-label-primary); margin: 0; font-size: 16px; font-weight: 510; line-height: 24px; }
.${CSS_PREFIX}__close { cursor: pointer; color: var(--dsw-alias-label-tertiary); background: 0 0; border: none; border-radius: var(--dsw-radius-sm, 6px); width: 26px; height: 26px; font-size: 14px; }
.${CSS_PREFIX}__close:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.${CSS_PREFIX}__close:disabled { opacity: .4; cursor: default; }
.${CSS_PREFIX}__crumbs { scrollbar-width: none; align-items: center; gap: 2px; display: flex; overflow-x: auto; }
.${CSS_PREFIX}__iconBtn { cursor: pointer; color: var(--dsw-alias-label-secondary); background: 0 0; border: none; border-radius: var(--dsw-radius-sm, 6px); flex: none; width: 22px; height: 22px; font-size: 13px; line-height: 20px; }
.${CSS_PREFIX}__iconBtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.${CSS_PREFIX}__iconBtn:disabled { opacity: .35; cursor: default; }
.${CSS_PREFIX}__crumbSep { color: var(--dsw-alias-label-tertiary); flex: none; font-size: 12px; }
.${CSS_PREFIX}__crumb { cursor: pointer; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); background: 0 0; border: none; border-radius: var(--dsw-radius-sm, 6px); flex: none; max-width: 160px; padding: 1px 5px; font-size: 13px; font-weight: 500; line-height: 20px; overflow: hidden; }
.${CSS_PREFIX}__crumb:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.${CSS_PREFIX}__crumb:disabled { cursor: default; }
.${CSS_PREFIX}__crumbCurrent { color: var(--dsw-alias-label-primary); }
.${CSS_PREFIX}__pathBar {
  border-radius: var(--dsw-radius-sm, 6px);
  color: var(--dsw-alias-label-primary);
  border: 1px solid #0000;
  background: 0 0;
  outline: none;
  width: 100%;
  padding: 3px 8px;
  font-size: 13px;
  line-height: 20px;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
}
.${CSS_PREFIX}__pathBar:hover, .${CSS_PREFIX}__pathBar:focus-visible { border-color: var(--dsw-alias-border-l2); }
.${CSS_PREFIX}__body { flex-direction: column; flex: 1 1 0; min-height: 0; gap: 4px; padding: 12px 16px; display: flex; position: relative; }
.${CSS_PREFIX}__list { scrollbar-width: thin; flex-direction: column; gap: 2px; flex: 1 1 0; min-height: 0; display: flex; overflow-y: auto; }
.${CSS_PREFIX}__item {
  border-radius: var(--dsw-radius-sm, 6px);
  cursor: pointer;
  text-align: left;
  background: 0 0;
  border: none;
  color: var(--dsw-alias-label-primary);
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 4px 6px;
  font-size: 13px;
  line-height: 20px;
  display: flex;
}
.${CSS_PREFIX}__item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.${CSS_PREFIX}__item:disabled { cursor: default; opacity: .5; }
.${CSS_PREFIX}__itemIcon { color: var(--dsw-alias-label-secondary); flex: none; display: flex; }
.${CSS_PREFIX}__itemName { text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1 1 0; overflow: hidden; }
.${CSS_PREFIX}__itemDim { color: var(--dsw-alias-label-tertiary); }
.${CSS_PREFIX}__status { color: var(--dsw-alias-label-secondary); padding: 4px 6px; font-size: 12px; line-height: 18px; }
.${CSS_PREFIX}__notice { border-radius: var(--dsw-radius-sm, 6px); color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 4%)); padding: 5px 8px; font-size: 12px; line-height: 18px; }
.${CSS_PREFIX}__create { border-radius: var(--dsw-radius-sm, 6px); flex: none; flex-direction: column; gap: 8px; padding: 10px; display: flex; background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 4%)); }
.${CSS_PREFIX}__createLabel { color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
.${CSS_PREFIX}__createInput {
  box-sizing: border-box;
  border-radius: var(--dsw-radius-md, 8px);
  color: var(--dsw-alias-label-primary);
  background: 0 0;
  border: .5px solid var(--dsw-alias-border-l4);
  outline: none;
  padding: 7px 12px;
  font-size: 14px;
  line-height: 22px;
  width: 100%;
}
.${CSS_PREFIX}__createActions { justify-content: flex-end; align-items: center; gap: 8px; display: flex; }
.${CSS_PREFIX}__footer { border-top: .5px solid var(--dsw-alias-border-l3); flex-wrap: wrap; flex: none; align-items: center; gap: 8px; padding: 12px 16px; display: flex; }
.${CSS_PREFIX}__footerGap { flex: 1 1 0; }
.${CSS_PREFIX}__toggle { cursor: pointer; color: var(--dsw-alias-label-secondary); white-space: nowrap; align-items: center; gap: 6px; font-size: 13px; line-height: 20px; display: inline-flex; }
.${CSS_PREFIX}__toggle:hover { color: var(--dsw-alias-label-primary); }
.${CSS_PREFIX}__toggle input { width: 14px; height: 14px; cursor: pointer; accent-color: var(--dsw-alias-button-info-fill, var(--dsw-alias-accent, #247bbf)); }
`;

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        localeService = ctx.locale;
        settingsStore = createStore({ ...DEFAULT_SETTINGS });
        void fetchSettings().then(
          (settings) => {
            if (settings !== null && typeof settings === 'object') settingsStore.set(settings);
          },
          (error) => {
            console.warn(`[${NS}] settings read failed:`, error);
          },
        );

        // Registry dictionaries too, so `locale: NS` on the settings row and
        // the flow registrations resolve against them (the same two-step the
        // companion plugins use: registry for the slot kit, t() above for
        // components rendered outside a locale-scoped entry).
        ctx.effect(() => ctx.locale.register(NS, 'zh', DICTS.zh), `${NS}: zh dictionary`);
        ctx.effect(() => ctx.locale.register(NS, 'en', DICTS.en), `${NS}: en dictionary`);

        // One owned <style> element, tagged for loader accounting and removed
        // with the client run.
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {};
          const style = document.createElement('style');
          style.id = `${CSS_PREFIX}__styles`;
          style.dataset.plugin = NS;
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => { style.remove(); };
        }, `${NS}: styles`);

        // The browse face both callers use: the settings row's chooser and the
        // workspace flow occupants share one implementation.
        const browseFace = () => ({
          listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
          createDirectory: (path, name) => ctx.uiWorkspace.createDirectory(path, name),
        });

        // The General row. order 18 sits in the free gap between 网页链接默认打开
        // 方式 (17) and 代码工作工具 (20).
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: NS,
          order: 18,
          locale: NS,
          inject: () => ({
            ...browseFace(),
            hooks: { settings: settingsStore },
          }),
        }, SettingsRow));

        // Both directory-flow holes at priority -2, in one generator so a
        // conflict in the second hole rolls the first back instead of leaving
        // a partial mix. The holes stay occupied, so the owner keeps rendering
        // its 添加工作区 affordance.
        const [hero, sidebar] = FLOW_HOLES;
        ctx.slots.inject(hero, () => ctx.slots.inject(sidebar, function* () {
          yield ctx.slots.register({ name: hero, inject: browseFace, priority: -2 }, WorkspaceDirectoryFlow);
          yield ctx.slots.register({ name: sidebar, inject: browseFace, priority: -2 }, WorkspaceDirectoryFlow);
        }));
      },
    };
  },
});
