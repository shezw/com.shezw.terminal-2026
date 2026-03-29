# shezw.com Terminal 2026

A terminal-style "under construction" page for shezw.com.

## Features

- Full-screen terminal UI with Ubuntu-style welcome message
- Virtual filesystem with `cd`, `ls`, `cat`, `view`, `help`, `login`, `logout`
- Blog content fetched from remote `list.md` files
- Markdown rendering in `view` mode
- Tab auto-completion & command history
- Login/logout placeholder

## Usage

Serve `index.html` as the site root. Blog content is fetched from `/blog/{category}/list.md`.

## Typecho Export

This repository also includes a Typecho export tool that can import a MySQL dump into a temporary MariaDB instance and export published posts into mapped markdown folders.

Install Python dependencies:

```bash
python3 -m pip install -r requirements.txt
```

Start a temporary MariaDB container and import the dump:

```bash
python3 scripts/typecho_export.py prepare-db \
	--dump shezw_com_2026-03-29_18-58-36_mysql_data_z7W50.sql
```

Export published posts into mapped markdown folders:

```bash
python3 scripts/typecho_export.py export \
	--site-domain shezw.com \
	--site-domain www.shezw.com \
	--clean
```

Or run both steps in one command:

```bash
python3 scripts/typecho_export.py full-export \
	--dump shezw_com_2026-03-29_18-58-36_mysql_data_z7W50.sql \
	--site-domain shezw.com \
	--site-domain www.shezw.com \
	--clean
```

Outputs:

- `exported_blog/blog/.../*.md`: exported markdown files
- `exported_blog/blog/.../*.md` symlinks: secondary-category entries
- `exported_blog/blog/.../list.md`: terminal index files in `title` + `size,created,updated` format
- `exported_blog/_audit/internal_assets.csv`: internal image/resource audit
- `exported_blog/_audit/unmapped_categories.csv`: categories that did not match the mapping config

Category mapping is configured in `typecho_category_mapping.json`.
