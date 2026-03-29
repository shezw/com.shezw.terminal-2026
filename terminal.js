/**
 * Terminal engine for shezw.com furnish page
 */

const Terminal = (() => {
  const HOSTNAME = location.hostname || 'shezw.com';
  const USERNAME = 'visitor';
  const VERSION  = '0.1.3';

  // Login credentials store (placeholder)
  const credentials = {
    admin: 'shezw2026'
  };

  let loggedInUser = null;
  let inputMode = 'command'; // 'command' | 'login-user' | 'login-pass'
  let loginBuffer = {};

  // DOM references
  let termOutput, termInput, termPrompt, termInputLine;

  // Command history
  const history = [];
  let historyIndex = -1;

  // Tab completion file cache reference
  let tabCandidates = [];

  function setInputMasked(masked) {
    termInput.classList.toggle('masked', masked);
    termInput.setAttribute('aria-label', masked ? 'Terminal secure entry' : 'Terminal command line');
  }

  function setInputValue(value) {
    termInput.value = value;
    syncInputHeight();
  }

  function clearInput() {
    setInputValue('');
  }

  function syncInputHeight() {
    termInput.style.height = 'auto';
    termInput.style.height = `${Math.max(termInput.scrollHeight, 21)}px`;
  }

  function init() {
    termOutput    = document.getElementById('output');
    termInput     = document.getElementById('input');
    termPrompt    = document.getElementById('prompt');
    termInputLine = document.getElementById('input-line');

    termInput.addEventListener('keydown', onKeyDown);
    termInput.addEventListener('input', syncInputHeight);
    document.addEventListener('click', () => termInput.focus());

    updatePrompt();
    setInputMasked(false);
    printWelcome();
    syncInputHeight();
    termInput.focus();
  }

  function updatePrompt() {
    const user = loggedInUser || USERNAME;
    termPrompt.textContent = `${user}@${HOSTNAME}:${VFS.getCwdString()}$ `;
  }

  function printWelcome() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
    const lines = [
      `Welcome to shezw.com Terminal v${VERSION} (UTF-8)`,
      ``,
      ` * This site is currently under furnishing...`,
      ` * Documentation:  https://shezw.com/about`,
      ` * Blog:           https://shezw.com/blog`,
      ``,
      `  System information as of ${dateStr}`,
      ``,
      `  Hostname:   ${HOSTNAME}`,
      `  Status:     🔧 Under Construction`,
      `  Theme:      Furnish-2026`,
      ``,
      `Last login: ${dateStr} from ${HOSTNAME}`,
      ``
    ];
    for (const line of lines) {
      appendOutput(line, 'welcome');
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = termInput.value;
      clearInput();
      handleInput(raw);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        if (historyIndex < history.length - 1) historyIndex++;
        setInputValue(history[history.length - 1 - historyIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        setInputValue(history[history.length - 1 - historyIndex]);
      } else {
        historyIndex = -1;
        clearInput();
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      void handleTab();
    } else if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      const promptText = termPrompt.textContent;
      appendOutput(promptText + termInput.value + '^C', 'command-echo');
      clearInput();
      if (inputMode !== 'command') {
        inputMode = 'command';
        loginBuffer = {};
        setInputMasked(false);
      }
      updatePrompt();
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      termOutput.innerHTML = '';
    }
  }

  function handleInput(raw) {
    if (inputMode === 'login-user') {
      appendOutput(raw);
      loginBuffer.username = raw;
      inputMode = 'login-pass';
      termPrompt.textContent = 'Password: ';
      setInputMasked(true);
      return;
    }

    if (inputMode === 'login-pass') {
      appendOutput('********');
      loginBuffer.password = raw;
      setInputMasked(false);
      inputMode = 'command';
      doLogin(loginBuffer.username, loginBuffer.password);
      loginBuffer = {};
      updatePrompt();
      return;
    }

    // Command mode
    const promptText = termPrompt.textContent;
    appendOutput(promptText + raw, 'command-echo');

    const trimmed = raw.trim();
    if (!trimmed) {
      updatePrompt();
      return;
    }

    history.push(trimmed);
    historyIndex = -1;

    const parts = tokenizeCommand(trimmed);
    if (parts.length === 0) {
      updatePrompt();
      return;
    }

    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    executeCommand(cmd, args);
  }

  function executeCommand(cmd, args) {
    switch (cmd) {
      case 'help':    cmdHelp(); break;
      case 'ls':      cmdLs(args); break;
      case 'cd':      cmdCd(args); break;
      case 'cat':     void cmdCat(args); return;
      case 'view':    void cmdView(args); return;
      case 'login':   cmdLogin(); return;
      case 'logout':  cmdLogout(); break;
      case 'clear':   termOutput.innerHTML = ''; updatePrompt(); return;
      case 'pwd':     appendOutput(VFS.getCwdString()); break;
      case 'whoami':  appendOutput(loggedInUser || USERNAME); break;
      default:
        appendOutput(`${cmd}: command not found. Type 'help' for available commands.`, 'error');
    }
    updatePrompt();
  }

  // ── Commands ──────────────────────────────────

  function cmdHelp() {
    const lines = [
      'Available commands:',
      '',
      '  ls [-lh] [path] List directory contents',
      '  cd [path]      Change directory',
      '  cat <file>     Display file content (raw)',
      '  view <file>    Display file content (formatted)',
      '  pwd            Print working directory',
      '  whoami         Print current user',
      '  login          Login to system',
      '  logout         Logout from system',
      '  clear          Clear terminal',
      '  help           Show this help',
      '',
      'Navigation: Use Tab for auto-complete, ↑↓ for history',
      'Shortcuts: Ctrl+C to cancel, Ctrl+L to clear screen',
    ];
    for (const l of lines) appendOutput(l);
  }

  function cmdCd(args) {
    const target = args[0] || '/';
    const segments = VFS.resolve(target);
    if (segments === null) {
      appendOutput(`cd: invalid path: ${target}`, 'error');
      return;
    }
    if (!VFS.isDir(segments)) {
      appendOutput(`cd: not a directory: ${target}`, 'error');
      return;
    }
    VFS.setCwd(segments);
  }

  function cmdLs(args) {
    // Parse flags and target
    let longFormat = false;
    let target = '.';
    for (const arg of args) {
      if (arg.startsWith('-')) {
        if (arg.includes('l')) longFormat = true;
        // -h is accepted alongside -l, handled in formatting
      } else {
        target = arg;
      }
    }

    const segments = VFS.resolve(target);
    if (segments === null || !VFS.isDir(segments)) {
      appendOutput(`ls: cannot access '${target}': No such directory`, 'error');
      return;
    }

    const children = VFS.listDir(segments);

    if (children === null) {
      // Need to fetch from remote
      fetchFileList(segments, true).then(files => {
        if (files && files.length > 0) {
          const items = files.map(f => ({
            name: f.title,
            isDir: false,
            size: f.size || 0,
            createdAt: f.createdAt || 0,
            updatedAt: f.updatedAt || 0
          }));
          renderLs(items, longFormat);
        } else {
          appendOutput('(empty)', 'dim');
        }
        updatePrompt();
        scrollToBottom();
      });
      return;
    }

    if (children.length === 0) {
      appendOutput('(empty)', 'dim');
      return;
    }
    renderLs(children, longFormat);
  }

  function renderLs(items, longFormat) {
    const normalizedItems = normalizeLsItems(items);

    if (longFormat) {
      appendOutput(`total ${normalizedItems.length}`, 'dim');
      for (const item of normalizedItems) {
        const type = item.isExec ? '-rwxr-xr-x' : (item.isDir ? 'drwxr-xr-x' : '-rw-r--r--');
        const size = formatSize(item.size || 0);
        const date = formatListDate(item.createdAt, item.updatedAt);
        const cls = item.isDir ? 'dir' : (item.isExec ? 'exec' : 'file');
        appendOutput(`${type}  1 visitor visitor  ${size.padStart(6)}  ${date}  ${item.name}`, cls);
      }
    } else {
      for (const item of normalizedItems) {
        const cls = item.isDir ? 'dir' : (item.isExec ? 'exec' : 'file');
        appendOutput(item.name, cls);
      }
    }
  }

  function normalizeLsItems(items) {
    return items.map(item => {
      if (typeof item === 'string') {
        return {
          name: item,
          isDir: item.endsWith('/'),
          isExec: false,
          size: 0
        };
      }

      return {
        name: item.name || item.title || '',
        isDir: Boolean(item.isDir),
        isExec: Boolean(item.isExec),
        size: Number(item.size || 0),
        createdAt: Number(item.createdAt || 0),
        updatedAt: Number(item.updatedAt || 0)
      };
    }).filter(item => item.name);
  }

  function formatListDate(createdAt, updatedAt) {
    const timestamp = updatedAt || createdAt;
    if (!timestamp) return '--- -- --:--';

    const date = new Date(timestamp * 1000);
    const now = new Date();
    const month = date.toLocaleString('en-US', { month: 'short' });
    const day = String(date.getDate()).padStart(2, ' ');

    if (date.getFullYear() === now.getFullYear()) {
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${month} ${day} ${hours}:${minutes}`;
    }

    return `${month} ${day}  ${date.getFullYear()}`;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K';
    return (bytes / (1024 * 1024)).toFixed(1) + 'M';
  }

  function tokenizeCommand(input) {
    const parts = [];
    let current = '';
    let quote = null;

    for (let index = 0; index < input.length; index++) {
      const char = input[index];

      if (char === '\\' && index + 1 < input.length) {
        current += input[index + 1];
        index += 1;
        continue;
      }

      if (quote) {
        if (char === quote) {
          quote = null;
        } else {
          current += char;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (/\s/.test(char)) {
        if (current) {
          parts.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  async function cmdCat(args) {
    if (args.length === 0) {
      appendOutput('cat: missing filename', 'error');
      return;
    }

    const target = args.join(' ');
    const resolved = await resolveContentRequest(target);
    if (!resolved.ok) {
      appendOutput(`cat: ${target}: ${resolved.message}`, 'error');
      return;
    }

    if (resolved.kind === 'directory') {
      await displayFileCandidates(resolved.dirSegments, target);
      return;
    }

    await fetchAndDisplayFile(resolved.contentPath, resolved.filename, 'cat');
  }

  async function cmdView(args) {
    if (args.length === 0) {
      appendOutput('view: missing filename', 'error');
      return;
    }

    const target = args.join(' ');
    const resolved = await resolveContentRequest(target);
    if (!resolved.ok) {
      appendOutput(`view: ${target}: ${resolved.message}`, 'error');
      return;
    }

    if (resolved.kind === 'directory') {
      await displayFileCandidates(resolved.dirSegments, target);
      return;
    }

    await fetchAndDisplayFile(resolved.contentPath, resolved.filename, 'view');
  }

  function cmdLogin() {
    if (loggedInUser) {
      appendOutput(`Already logged in as ${loggedInUser}. Use 'logout' first.`, 'warn');
      updatePrompt();
      return;
    }
    inputMode = 'login-user';
    termPrompt.textContent = 'Username: ';
  }

  function cmdLogout() {
    if (!loggedInUser) {
      appendOutput('Not logged in.', 'warn');
      return;
    }
    appendOutput(`Goodbye, ${loggedInUser}.`);
    loggedInUser = null;
  }

  function doLogin(username, password) {
    if (credentials[username] && credentials[username] === password) {
      loggedInUser = username;
      appendOutput(`Welcome back, ${username}!`, 'success');
    } else {
      appendOutput('Login failed: invalid username or password.', 'error');
    }
  }

  // ── Remote fetching ───────────────────────────

  async function fetchFileList(segments, silent) {
    const contentPath = VFS.getContentPath(segments);
    if (!contentPath) return null;

    if (contentPath.base === 'about') {
      const cached = VFS.getCachedFiles(segments) || [];
      tabCandidates = cached.map(f => f.title);
      return cached;
    }

    const url = `./${contentPath.base}/${contentPath.relPath}/list.md`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        if (!silent) appendOutput(`fetch error: ${resp.status} ${resp.statusText}`, 'error');
        return null;
      }
      const text = await resp.text();
      const files = parseFileList(text);
      VFS.cacheFiles(segments, files);
      tabCandidates = files.map(f => f.title);
      return files;
    } catch (err) {
      if (!silent) appendOutput(`fetch error: ${err.message}`, 'error');
      return null;
    }
  }

  /**
   * Parse the list.md format:
   * - title
   * size,createdAt,updatedAt
   *
   * - title2
   * size2,createdAt2,updatedAt2
   */
  function parseFileList(text) {
    const files = [];
    const lines = text.split('\n');
    let currentTitle = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        currentTitle = trimmed.slice(2).trim();
      } else if (currentTitle && /^\d+(,\d+){0,2}$/.test(trimmed)) {
        const [size = '0', createdAt = '0', updatedAt = '0'] = trimmed.split(',');
        files.push({
          title: currentTitle,
          size: Number(size),
          createdAt: Number(createdAt),
          updatedAt: Number(updatedAt)
        });
        currentTitle = null;
      }
    }
    return files;
  }

  async function fetchAndDisplayFile(contentPath, filename, mode) {
    const url = buildContentFileUrl(contentPath, filename);
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        appendOutput(`fetch error: ${resp.status} ${resp.statusText}`, 'error');
        updatePrompt();
        scrollToBottom();
        return;
      }
      const text = await resp.text();
      if (mode === 'cat') {
        displayRaw(text);
      } else {
        displayFormatted(text);
      }
    } catch (err) {
      appendOutput(`fetch error: ${err.message}`, 'error');
    }
    updatePrompt();
    scrollToBottom();
  }

  async function resolveContentRequest(target) {
    if (target.endsWith('/')) {
      const dirTarget = target.replace(/\/+$/, '');
      const dirSegments = VFS.resolve(dirTarget || '/');
      if (!dirSegments || !VFS.isDir(dirSegments)) {
        return { ok: false, message: 'No such directory' };
      }
      if (!VFS.isLeaf(dirSegments)) {
        return { ok: false, message: 'not in a content directory' };
      }
      return { ok: true, kind: 'directory', dirSegments };
    }

    const { dirSegments, filename, error } = splitContentTarget(target);
    if (error) {
      return { ok: false, message: error };
    }

    const contentPath = VFS.getContentPath(dirSegments);
    if (!contentPath) {
      return { ok: false, message: 'cannot determine content path' };
    }

    let existsInCache = VFS.fileExistsInCache(dirSegments, filename);
    if (!existsInCache) {
      await fetchFileList(dirSegments, true);
      existsInCache = VFS.fileExistsInCache(dirSegments, filename);
    }

    if (!existsInCache) {
      return { ok: false, message: 'No such file' };
    }

    return { ok: true, kind: 'file', dirSegments, contentPath, filename };
  }

  function splitContentTarget(target) {
    const lastSlash = target.lastIndexOf('/');
    let dirSegments;
    let filename;

    if (lastSlash >= 0) {
      const dirPart = target.slice(0, lastSlash) || '/';
      filename = target.slice(lastSlash + 1);
      dirSegments = VFS.resolve(dirPart);
    } else {
      dirSegments = VFS.getCwd();
      filename = target;
    }

    if (!filename) {
      return { error: 'missing filename' };
    }
    if (!dirSegments || !VFS.isDir(dirSegments)) {
      return { error: 'No such directory' };
    }
    if (!VFS.isLeaf(dirSegments)) {
      return { error: 'not in a content directory' };
    }

    return { dirSegments, filename };
  }

  function buildContentFileUrl(contentPath, filename) {
    const encodedParts = [
      contentPath.base,
      ...contentPath.relPath.split('/').filter(Boolean),
      `${filename}.md`
    ].map(part => encodeURIComponent(part));
    return `./${encodedParts.join('/')}`;
  }

  async function displayFileCandidates(dirSegments, prefix) {
    let cached = VFS.getCachedFiles(dirSegments);
    if (!cached) {
      await fetchFileList(dirSegments, true);
      cached = VFS.getCachedFiles(dirSegments);
    }

    if (!cached || cached.length === 0) {
      appendOutput('(empty)', 'dim');
      updatePrompt();
      scrollToBottom();
      return;
    }

    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    for (const file of cached) {
      appendOutput(`${normalizedPrefix}${file.title}`, 'file');
    }
    updatePrompt();
    scrollToBottom();
  }

  function displayRaw(text) {
    const lines = text.split('\n');
    for (const line of lines) {
      appendOutputHTML(`<div>${renderPlainText(line)}</div>`);
    }
  }

  function displayFormatted(text) {
    const lines = text.split('\n');
    let inCodeBlock = false;

    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        appendOutputHTML('<div class="md-code-fence">───</div>');
        continue;
      }

      if (inCodeBlock) {
        appendOutputHTML(`<div class="md-code">${escapeHTML(line)}</div>`);
        continue;
      }

      const imageHTML = renderMarkdownImage(line);
      if (imageHTML) {
        appendOutputHTML(imageHTML);
        continue;
      }

      // Headings
      if (line.startsWith('######')) {
        appendOutputHTML(`<div class="md-h6">${renderInlineMarkdown(line.slice(6).trim())}</div>`);
      } else if (line.startsWith('#####')) {
        appendOutputHTML(`<div class="md-h5">${renderInlineMarkdown(line.slice(5).trim())}</div>`);
      } else if (line.startsWith('####')) {
        appendOutputHTML(`<div class="md-h4">${renderInlineMarkdown(line.slice(4).trim())}</div>`);
      } else if (line.startsWith('###')) {
        appendOutputHTML(`<div class="md-h3">${renderInlineMarkdown(line.slice(3).trim())}</div>`);
      } else if (line.startsWith('##')) {
        appendOutputHTML(`<div class="md-h2">${renderInlineMarkdown(line.slice(2).trim())}</div>`);
      } else if (line.startsWith('#')) {
        appendOutputHTML(`<div class="md-h1">${renderInlineMarkdown(line.slice(1).trim())}</div>`);
      } else if (line.startsWith('---') || line.startsWith('***') || line.startsWith('___')) {
        appendOutputHTML('<div class="md-hr">────────────────────────────────</div>');
      } else if (line.startsWith('> ')) {
        appendOutputHTML(`<div class="md-quote">│ ${renderInlineMarkdown(line.slice(2))}</div>`);
      } else if (/^\s*[-*]\s/.test(line)) {
        appendOutputHTML(`<div class="md-list">  • ${renderInlineMarkdown(line.replace(/^\s*[-*]\s/, ''))}</div>`);
      } else if (/^\s*\d+\.\s/.test(line)) {
        appendOutputHTML(`<div class="md-list">  ${renderInlineMarkdown(line)}</div>`);
      } else {
        appendOutputHTML(`<div class="md-text">${renderInlineMarkdown(line)}</div>`);
      }
    }
  }

  function renderInlineMarkdown(text) {
    const tokens = [];
    let html = escapeHTML(text);

    html = html.replace(/`([^`]+)`/g, (_, code) => {
      return createHTMLToken(tokens, `<span class="md-inline-code">${code}</span>`);
    });

    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
      return createHTMLToken(tokens, buildLinkHTML(url, label, 'md-link'));
    });

    html = linkifyEscapedText(html, 'md-link');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<span class="md-bold">$1</span>');
    html = html.replace(/\*([^*]+)\*/g, '<span class="md-italic">$1</span>');
    return restoreHTMLTokens(html, tokens);
  }

  function renderPlainText(text) {
    return linkifyEscapedText(escapeHTML(text), 'plain-link');
  }

  function renderMarkdownImage(line) {
    const trimmed = line.trim();
    const markdownMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
    if (markdownMatch) {
      return buildImageHTML(markdownMatch[2], markdownMatch[1], markdownMatch[3]);
    }

    const htmlMatch = trimmed.match(/^<img\b[^>]*src=["']([^"']+)["'][^>]*>$/i);
    if (!htmlMatch) {
      return '';
    }

    const altMatch = trimmed.match(/\balt=["']([^"']*)["']/i);
    const titleMatch = trimmed.match(/\btitle=["']([^"']*)["']/i);
    return buildImageHTML(htmlMatch[1], altMatch ? altMatch[1] : '', titleMatch ? titleMatch[1] : '');
  }

  function buildImageHTML(src, alt, title) {
    const safeSrc = escapeAttribute(src);
    const safeAlt = escapeAttribute(alt || title || 'image');
    const safeTitle = title ? ` title="${escapeAttribute(title)}"` : '';
    return `<div class="md-image-wrap"><a class="md-image-link" href="${safeSrc}" target="_blank" rel="noopener noreferrer"><img class="md-image" src="${safeSrc}" alt="${safeAlt}"${safeTitle}></a></div>`;
  }

  function linkifyEscapedText(text, className) {
    return text.replace(/https?:\/\/[^\s<]+/g, url => {
      const { cleanUrl, trailing } = splitTrailingPunctuation(url);
      return `${buildLinkHTML(cleanUrl, cleanUrl, className)}${trailing}`;
    });
  }

  function splitTrailingPunctuation(url) {
    const match = url.match(/^(.*?)([),.;!?]+)?$/);
    if (!match) {
      return { cleanUrl: url, trailing: '' };
    }
    return {
      cleanUrl: match[1] || url,
      trailing: match[2] || ''
    };
  }

  function buildLinkHTML(url, label, className) {
    const safeUrl = escapeAttribute(url);
    const safeLabel = escapeHTML(label);
    return `<a class="${className}" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
  }

  function createHTMLToken(tokens, html) {
    const token = `@@HTML_TOKEN_${tokens.length}@@`;
    tokens.push({ token, html });
    return token;
  }

  function restoreHTMLTokens(text, tokens) {
    let restored = text;
    for (const token of tokens) {
      restored = restored.replaceAll(token.token, token.html);
    }
    return restored;
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttribute(str) {
    return escapeHTML(str).replace(/'/g, '&#39;');
  }

  // ── Tab completion ────────────────────────────

  async function handleTab() {
    const value = termInput.value;
    const parts = tokenizeCommand(value);
    if (parts.length <= 1) {
      // Complete command
      const cmds = ['help', 'ls', 'cd', 'cat', 'view', 'login', 'logout', 'clear', 'pwd', 'whoami'];
      const match = cmds.filter(c => c.startsWith(parts[0]));
      if (match.length === 1) {
        setInputValue(match[0] + ' ');
      } else if (match.length > 1) {
        appendOutput(termPrompt.textContent + value, 'command-echo');
        appendOutput(match.join('  '));
      }
      return;
    }

    // Complete path argument
    const partial = getCompletionTarget(value, parts);
    const candidates = await getPathCandidates(partial);
    if (candidates.length === 1) {
      setInputValue(replaceCompletionTarget(value, partial, candidates[0]));
    } else if (candidates.length > 1) {
      appendOutput(termPrompt.textContent + value, 'command-echo');
      appendOutput(candidates.join('  '));
      updatePrompt();
    }
  }

  async function getPathCandidates(partial) {
    // Get directory and prefix
    const lastSlash = partial.lastIndexOf('/');
    let dirPart, prefix;
    if (lastSlash >= 0) {
      dirPart = partial.slice(0, lastSlash) || '/';
      prefix = partial.slice(lastSlash + 1);
    } else {
      dirPart = '.';
      prefix = partial;
    }

    const segments = VFS.resolve(dirPart);
    if (!segments || !VFS.isDir(segments)) return [];

    const children = VFS.listDir(segments);
    if (!children) {
      let cached = VFS.getCachedFiles(segments);
      if (!cached) {
        await fetchFileList(segments, true);
        cached = VFS.getCachedFiles(segments);
      }

      if (cached) {
        return cached
          .map(f => f.title)
          .filter(t => t.toLowerCase().startsWith(prefix.toLowerCase()));
      }
      return [];
    }

    return children
      .map(c => c.name)
      .filter(c => c.toLowerCase().startsWith(prefix.toLowerCase()))
      .map(c => {
        if (lastSlash >= 0) return partial.slice(0, lastSlash + 1) + c;
        return c;
      });
  }

  function getCompletionTarget(value, parts) {
    const command = parts[0] || '';
    if ((command === 'cat' || command === 'view') && value.includes(' ')) {
      return value.slice(value.indexOf(' ') + 1).trimStart();
    }
    return parts[parts.length - 1] || '';
  }

  function replaceCompletionTarget(value, partial, replacement) {
    const index = value.lastIndexOf(partial);
    if (index < 0) {
      return value;
    }
    return `${value.slice(0, index)}${replacement}`;
  }

  // ── Output helpers ────────────────────────────

  function appendOutput(text, className) {
    const div = document.createElement('div');
    div.textContent = text;
    if (className) div.className = className;
    termOutput.appendChild(div);
    scrollToBottom();
  }

  function appendOutputHTML(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    termOutput.appendChild(div);
    scrollToBottom();
  }

  function scrollToBottom() {
    const term = document.getElementById('terminal');
    term.scrollTop = term.scrollHeight;
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Terminal.init);
