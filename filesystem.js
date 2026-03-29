/**
 * Virtual Filesystem for shezw.com terminal
 */

const VFS = (() => {

  // Directory tree structure
  // null  = leaf directory (can fetch file list from remote)
  // {}    = directory with children
  const tree = {
    bin: {
      cd: null,
      ls: null,
      cat: null,
      view: null,
      help: null,
      login: null,
      logout: null
    },
    blog: {
      dev: {
        ios: null,
        android: null,
        web: null,
        backend: null,
        cpp: null,
        alg: null,
        webkit: null,
        linux: null,
        'machine-learning': null,
        embedded: null,
        python: null,
        rtos: null
      },
      design: {
        brand: null,
        uiux: null,
        illustration: null,
        photograph: null
      },
      notes: null,
      articles: null
    },
    about: {},
    dev: {}
  };

  // File list cache: key = absolute path, value = array of {title, id}
  const fileCache = {};

  // Current working directory as array of segments, e.g. ['blog','dev','ios']
  let cwd = [];

  /**
   * Resolve a path string (absolute or relative) against cwd.
   * Returns an array of segments or null if invalid.
   */
  function resolve(pathStr) {
    if (!pathStr) return [...cwd];
    let segments;
    if (pathStr.startsWith('/')) {
      segments = pathStr.split('/').filter(Boolean);
    } else {
      segments = [...cwd, ...pathStr.split('/').filter(s => s !== '')];
    }
    // Process . and ..
    const resolved = [];
    for (const seg of segments) {
      if (seg === '.') continue;
      if (seg === '..') {
        if (resolved.length > 0) resolved.pop();
        continue;
      }
      resolved.push(seg);
    }
    return resolved;
  }

  /**
   * Navigate the tree to the given segments array.
   * Returns the node or undefined if path doesn't exist.
   */
  function getNode(segments) {
    let node = tree;
    for (const seg of segments) {
      if (node === null || node === undefined) return undefined;
      if (typeof node !== 'object') return undefined;
      if (!(seg in node)) return undefined;
      node = node[seg];
    }
    return node;
  }

  /**
   * Check if segments point to a valid directory.
   */
  function isDir(segments) {
    if (segments.length === 0) return true; // root
    const node = getNode(segments);
    return node !== undefined; // null or object are both valid dirs
  }

  /**
   * Check if a directory is a leaf (no sub-directories, can list files from remote).
   */
  function isLeaf(segments) {
    if (segments.length === 0) return false;
    const node = getNode(segments);
    return node === null || (typeof node === 'object' && node !== null && Object.keys(node).length === 0);
  }

  /**
   * List children of a directory.
   * Returns array of names (with '/' suffix for sub-dirs).
   */
  function listDir(segments) {
    if (segments.length === 0) {
      return Object.keys(tree).map(k => k + '/');
    }
    const node = getNode(segments);
    if (node === null || (typeof node === 'object' && node !== null && Object.keys(node).length === 0)) {
      // Leaf dir – return cached file list or empty
      const key = '/' + segments.join('/');
      if (fileCache[key]) {
        return fileCache[key].map(f => f.title);
      }
      return null; // signal: need to fetch
    }
    if (typeof node === 'object' && node !== null) {
      return Object.keys(node).map(k => k + '/');
    }
    return [];
  }

  /**
   * Get the blog-relative path for remote fetching.
   * segments should be under /blog/...
   */
  function getBlogRelPath(segments) {
    if (segments.length >= 2 && segments[0] === 'blog') {
      return segments.slice(1).join('/');
    }
    return null;
  }

  /**
   * Cache file list for a directory.
   */
  function cacheFiles(segments, files) {
    const key = '/' + segments.join('/');
    fileCache[key] = files;
  }

  /**
   * Get cached files for a directory.
   */
  function getCachedFiles(segments) {
    const key = '/' + segments.join('/');
    return fileCache[key] || null;
  }

  /**
   * Check if a filename exists in the cache for the given directory.
   */
  function fileExistsInCache(dirSegments, filename) {
    const cached = getCachedFiles(dirSegments);
    if (!cached) return false;
    return cached.some(f => f.title === filename);
  }

  /**
   * Find file id by title in cache.
   */
  function getFileId(dirSegments, filename) {
    const cached = getCachedFiles(dirSegments);
    if (!cached) return null;
    const found = cached.find(f => f.title === filename);
    return found ? found.id : null;
  }

  function getCwd() {
    return [...cwd];
  }

  function getCwdString() {
    return '/' + cwd.join('/');
  }

  function setCwd(segments) {
    cwd = [...segments];
  }

  return {
    resolve,
    getNode,
    isDir,
    isLeaf,
    listDir,
    getBlogRelPath,
    cacheFiles,
    getCachedFiles,
    fileExistsInCache,
    getFileId,
    getCwd,
    getCwdString,
    setCwd
  };
})();
