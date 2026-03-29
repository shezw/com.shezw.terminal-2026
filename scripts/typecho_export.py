#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

import pymysql
from pymysql.cursors import DictCursor


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_MAPPING_FILE = REPO_ROOT / "typecho_category_mapping.json"
DEFAULT_EXPORT_ROOT = REPO_ROOT / "exported_blog"
MARKDOWN_SENTINEL = "<!--markdown-->"


@dataclass
class Category:
    name: str
    slug: str


@dataclass
class Post:
    cid: int
    title: str
    slug: str
    created: int
    modified: int
    text: str
    categories: List[Category] = field(default_factory=list)


@dataclass
class ExportedPost:
    cid: int
    title: str
    file_title: str
    size: int
    created: int
    modified: int
    real_path: Path
    category_paths: List[Path]
    original_categories: List[str]
    mapped_categories: List[str]
    unmapped_categories: List[str]


class ResourceHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.resources: List[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key.lower(): value for key, value in attrs}
        if tag == "img" and attr_map.get("src"):
            self.resources.append(("img", attr_map["src"]))
        elif tag == "source" and attr_map.get("src"):
            self.resources.append(("source", attr_map["src"]))
        elif tag == "a" and attr_map.get("href"):
            self.resources.append(("a", attr_map["href"]))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export Typecho posts into mapped markdown folders.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare-db", help="Start a temporary MariaDB container and import a dump.")
    prepare_parser.add_argument("--dump", required=True, help="Path to the MySQL dump file.")
    prepare_parser.add_argument("--container", default="typecho-migrate", help="Docker container name.")
    prepare_parser.add_argument("--image", default="mariadb:10.11", help="MariaDB image tag.")
    prepare_parser.add_argument("--database", default="typecho", help="Database name.")
    prepare_parser.add_argument("--user", default="root", help="Database user.")
    prepare_parser.add_argument("--password", default="root", help="Database password.")
    prepare_parser.add_argument("--port", type=int, default=3307, help="Published local port.")

    export_parser = subparsers.add_parser("export", help="Export published posts from Typecho into markdown.")
    export_parser.add_argument("--host", default="127.0.0.1", help="MySQL host.")
    export_parser.add_argument("--port", type=int, default=3307, help="MySQL port.")
    export_parser.add_argument("--user", default="root", help="MySQL user.")
    export_parser.add_argument("--password", default="root", help="MySQL password.")
    export_parser.add_argument("--database", default="typecho", help="Database name.")
    export_parser.add_argument("--table-prefix", default="typecho_", help="Typecho table prefix.")
    export_parser.add_argument("--mapping", default=str(DEFAULT_MAPPING_FILE), help="Category mapping JSON file.")
    export_parser.add_argument("--output", default=str(DEFAULT_EXPORT_ROOT), help="Export root directory.")
    export_parser.add_argument("--site-domain", action="append", default=[], help="Internal site domain used for resource audit. Repeatable.")
    export_parser.add_argument("--clean", action="store_true", help="Remove the output directory before exporting.")

    full_parser = subparsers.add_parser("full-export", help="Prepare a local MariaDB container, import the dump, then export posts.")
    full_parser.add_argument("--dump", required=True, help="Path to the MySQL dump file.")
    full_parser.add_argument("--container", default="typecho-migrate", help="Docker container name.")
    full_parser.add_argument("--image", default="mariadb:10.11", help="MariaDB image tag.")
    full_parser.add_argument("--host", default="127.0.0.1", help="MySQL host.")
    full_parser.add_argument("--database", default="typecho", help="Database name.")
    full_parser.add_argument("--user", default="root", help="Database user.")
    full_parser.add_argument("--password", default="root", help="Database password.")
    full_parser.add_argument("--port", type=int, default=3307, help="Published local port.")
    full_parser.add_argument("--table-prefix", default="typecho_", help="Typecho table prefix.")
    full_parser.add_argument("--mapping", default=str(DEFAULT_MAPPING_FILE), help="Category mapping JSON file.")
    full_parser.add_argument("--output", default=str(DEFAULT_EXPORT_ROOT), help="Export root directory.")
    full_parser.add_argument("--site-domain", action="append", default=[], help="Internal site domain used for resource audit. Repeatable.")
    full_parser.add_argument("--clean", action="store_true", help="Remove the output directory before exporting.")

    return parser.parse_args()


def load_mapping(mapping_path: Path) -> dict:
    with mapping_path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    return {
        "fallback": data.get("fallback", "blog/articles"),
        "category_slug": {normalize_key(key): value for key, value in data.get("category_slug", {}).items()},
        "category_name": {normalize_key(key): value for key, value in data.get("category_name", {}).items()}
    }


def normalize_key(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def connect_mysql(args: argparse.Namespace):
    return pymysql.connect(
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        database=args.database,
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=True,
    )


def fetch_posts(connection, table_prefix: str) -> list[Post]:
    contents_table = f"{table_prefix}contents"
    relationships_table = f"{table_prefix}relationships"
    metas_table = f"{table_prefix}metas"

    posts_sql = f"""
        SELECT cid, title, slug, created, modified, text
        FROM {contents_table}
        WHERE type = 'post' AND status = 'publish'
        ORDER BY created ASC, cid ASC
    """
    categories_sql = f"""
        SELECT r.cid, m.name, m.slug, m.mid
        FROM {relationships_table} AS r
        JOIN {metas_table} AS m ON m.mid = r.mid
        WHERE m.type = 'category'
        ORDER BY r.cid ASC, m.`order` ASC, m.mid ASC
    """

    with connection.cursor() as cursor:
        cursor.execute(posts_sql)
        rows = cursor.fetchall()

        cursor.execute(categories_sql)
        category_rows = cursor.fetchall()

    categories_by_cid: dict[int, list[Category]] = {}
    for row in category_rows:
        categories_by_cid.setdefault(row["cid"], []).append(Category(name=row["name"] or "", slug=row["slug"] or ""))

    posts: list[Post] = []
    for row in rows:
        posts.append(
            Post(
                cid=int(row["cid"]),
                title=(row["title"] or "").strip(),
                slug=(row["slug"] or "").strip(),
                created=int(row["created"] or 0),
                modified=int(row["modified"] or 0),
                text=row["text"] or "",
                categories=categories_by_cid.get(int(row["cid"]), []),
            )
        )

    return posts


def clean_output_dir(output_dir: Path) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def cleanup_body(text: str) -> str:
    body = text.replace("\r\n", "\n").replace("\r", "\n")
    if body.startswith(MARKDOWN_SENTINEL):
        body = body[len(MARKDOWN_SENTINEL):]
    return body.lstrip("\n")


def pick_mapped_paths(post: Post, mapping: dict) -> tuple[list[Path], list[str], list[str], list[str]]:
    mapped_paths: list[Path] = []
    mapped_labels: list[str] = []
    unmapped_labels: list[str] = []
    original_labels: list[str] = []

    for category in post.categories:
        label = category.slug or category.name
        if not label:
            continue
        original_labels.append(label)

        target = mapping["category_slug"].get(normalize_key(category.slug))
        if not target:
            target = mapping["category_name"].get(normalize_key(category.name))

        if target:
            path = Path(target)
            mapped_paths.append(path)
            mapped_labels.append(label)
        else:
            unmapped_labels.append(label)

    unique_paths: list[Path] = []
    seen: set[str] = set()
    for path in mapped_paths:
        key = path.as_posix()
        if key not in seen:
            unique_paths.append(path)
            seen.add(key)

    if not unique_paths:
        unique_paths = [Path(mapping["fallback"])]

    return unique_paths, original_labels, mapped_labels, unmapped_labels


def safe_file_title(title: str) -> str:
    sanitized = title.strip()
    sanitized = sanitized.replace("/", "-").replace("\\", "-")
    sanitized = sanitized.replace(":", "-").replace("\0", "")
    sanitized = re.sub(r"\s+", " ", sanitized)
    return sanitized or "untitled"


def ensure_unique_title(base_title: str, used_titles: dict[str, int], cid: int) -> str:
    count = used_titles.get(base_title, 0)
    if count == 0:
        used_titles[base_title] = 1
        return base_title

    used_titles[base_title] = count + 1
    return f"{base_title} (cid-{cid})"


def format_frontmatter(post: Post, file_title: str, mapped_paths: Sequence[Path], original_categories: Sequence[str], unmapped_categories: Sequence[str]) -> str:
    created = format_iso_datetime(post.created)
    modified = format_iso_datetime(post.modified)
    lines = [
        "---",
        f'title: "{escape_frontmatter(file_title)}"',
        f'typecho_title: "{escape_frontmatter(post.title)}"',
        f'typecho_slug: "{escape_frontmatter(post.slug)}"',
        f"typecho_cid: {post.cid}",
        f'date: "{created}"',
        f'updated: "{modified}"',
        "categories:",
    ]

    for category in original_categories:
        lines.append(f'  - "{escape_frontmatter(category)}"')

    lines.append("mapped_paths:")
    for path in mapped_paths:
        lines.append(f'  - "{escape_frontmatter(path.as_posix())}"')

    if unmapped_categories:
        lines.append("unmapped_categories:")
        for category in unmapped_categories:
            lines.append(f'  - "{escape_frontmatter(category)}"')

    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def escape_frontmatter(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def format_iso_datetime(timestamp: int) -> str:
    if not timestamp:
        return "1970-01-01 00:00:00"
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")


def extract_internal_resources(body: str, site_domains: Sequence[str]) -> list[tuple[str, str]]:
    resources: list[tuple[str, str]] = []

    for match in re.finditer(r"!\[[^\]]*\]\(([^)]+)\)", body):
        resources.append(("markdown-image", match.group(1).strip()))

    for match in re.finditer(r"(?<!!)\[[^\]]*\]\(([^)]+)\)", body):
        resources.append(("markdown-link", match.group(1).strip()))

    parser = ResourceHTMLParser()
    parser.feed(body)
    resources.extend(parser.resources)

    result: list[tuple[str, str]] = []
    domains = [domain.lower() for domain in site_domains if domain]
    for resource_type, resource_url in resources:
        if is_internal_resource(resource_url, domains):
            result.append((resource_type, resource_url))

    deduped: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in result:
        if item not in seen:
            deduped.append(item)
            seen.add(item)
    return deduped


def is_internal_resource(url: str, site_domains: Sequence[str]) -> bool:
    lower = url.lower()
    if lower.startswith("/"):
        return True
    if "/usr/uploads/" in lower or "/uploads/" in lower:
        return True
    return any(domain in lower for domain in site_domains)


def write_asset_audit(output_dir: Path, rows: Iterable[dict]) -> None:
    audit_dir = output_dir / "_audit"
    audit_dir.mkdir(parents=True, exist_ok=True)
    audit_file = audit_dir / "internal_assets.csv"

    with audit_file.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["cid", "title", "primary_path", "resource_type", "resource_url", "original_categories", "mapped_categories"],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def write_unmapped_report(output_dir: Path, rows: Iterable[dict]) -> None:
    audit_dir = output_dir / "_audit"
    audit_dir.mkdir(parents=True, exist_ok=True)
    report_file = audit_dir / "unmapped_categories.csv"

    with report_file.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["cid", "title", "unmapped_categories"])
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def generate_list_md(directory: Path, posts: Sequence[ExportedPost]) -> None:
    list_file = directory / "list.md"
    sorted_posts = sorted(posts, key=lambda item: (item.created, item.cid))
    lines: list[str] = []
    for post in sorted_posts:
        lines.append(f"- {post.file_title}")
        lines.append(f"{post.size},{post.created},{post.modified}")
        lines.append("")

    list_file.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def export_posts(args: argparse.Namespace) -> int:
    mapping = load_mapping(Path(args.mapping))
    output_dir = Path(args.output).resolve()
    if args.clean:
        clean_output_dir(output_dir)
    else:
        output_dir.mkdir(parents=True, exist_ok=True)

    connection = connect_mysql(args)
    try:
        posts = fetch_posts(connection, args.table_prefix)
    finally:
        connection.close()

    used_titles: dict[str, int] = {}
    list_entries: dict[Path, list[ExportedPost]] = {}
    asset_rows: list[dict] = []
    unmapped_rows: list[dict] = []

    for post in posts:
        mapped_paths, original_categories, mapped_categories, unmapped_categories = pick_mapped_paths(post, mapping)
        file_title = ensure_unique_title(safe_file_title(post.title), used_titles, post.cid)

        primary_dir = output_dir / mapped_paths[0]
        primary_file = primary_dir / f"{file_title}.md"
        ensure_parent(primary_file)

        body = cleanup_body(post.text)
        frontmatter = format_frontmatter(post, file_title, mapped_paths, original_categories, unmapped_categories)
        content = frontmatter + body.rstrip() + "\n"
        primary_file.write_text(content, encoding="utf-8")
        size = len(primary_file.read_text(encoding="utf-8").encode("utf-8"))

        exported = ExportedPost(
            cid=post.cid,
            title=post.title,
            file_title=file_title,
            size=size,
            created=post.created,
            modified=post.modified,
            real_path=primary_file,
            category_paths=list(mapped_paths),
            original_categories=original_categories,
            mapped_categories=mapped_categories,
            unmapped_categories=unmapped_categories,
        )

        for category_path in mapped_paths:
            absolute_category_dir = output_dir / category_path
            absolute_category_dir.mkdir(parents=True, exist_ok=True)
            list_entries.setdefault(absolute_category_dir, []).append(exported)

            target_file = absolute_category_dir / f"{file_title}.md"
            if target_file == primary_file:
                continue

            if target_file.exists() or target_file.is_symlink():
                target_file.unlink()
            relative_target = os.path.relpath(primary_file, start=absolute_category_dir)
            os.symlink(relative_target, target_file)

        resources = extract_internal_resources(body, args.site_domain)
        for resource_type, resource_url in resources:
            asset_rows.append(
                {
                    "cid": post.cid,
                    "title": file_title,
                    "primary_path": primary_file.relative_to(output_dir).as_posix(),
                    "resource_type": resource_type,
                    "resource_url": resource_url,
                    "original_categories": "|".join(original_categories),
                    "mapped_categories": "|".join(path.as_posix() for path in mapped_paths),
                }
            )

        if unmapped_categories:
            unmapped_rows.append({
                "cid": post.cid,
                "title": file_title,
                "unmapped_categories": "|".join(unmapped_categories),
            })

    for directory, exported_posts in list_entries.items():
        generate_list_md(directory, exported_posts)

    write_asset_audit(output_dir, asset_rows)
    write_unmapped_report(output_dir, unmapped_rows)

    print(f"Exported {len(posts)} published posts to {output_dir}")
    print(f"Asset audit: {(output_dir / '_audit' / 'internal_assets.csv').as_posix()}")
    print(f"Unmapped categories: {(output_dir / '_audit' / 'unmapped_categories.csv').as_posix()}")
    return 0


def run_command(command: list[str], stdin_path: Path | None = None) -> None:
    stdin_handle = None
    try:
        if stdin_path is not None:
            stdin_handle = stdin_path.open("rb")
        subprocess.run(command, stdin=stdin_handle, check=True)
    finally:
        if stdin_handle is not None:
            stdin_handle.close()


def container_exists(container_name: str) -> bool:
    result = subprocess.run(
        ["docker", "ps", "-a", "--filter", f"name=^{container_name}$", "--format", "{{.Names}}"],
        check=True,
        capture_output=True,
        text=True,
    )
    return container_name in result.stdout.splitlines()


def start_or_create_container(args: argparse.Namespace) -> None:
    if container_exists(args.container):
        run_command(["docker", "start", args.container])
        return

    run_command(
        [
            "docker", "run", "-d",
            "--name", args.container,
            "-e", f"MYSQL_ROOT_PASSWORD={args.password}",
            "-e", f"MYSQL_DATABASE={args.database}",
            "-p", f"{args.port}:3306",
            args.image,
        ]
    )


def wait_for_mariadb(args: argparse.Namespace, timeout_seconds: int = 60) -> None:
    deadline = time.time() + timeout_seconds
    command = [
        "docker", "exec", args.container,
        "mariadb-admin", "ping",
        f"-u{args.user}",
        f"-p{args.password}",
        "--silent",
    ]
    while time.time() < deadline:
        result = subprocess.run(command, capture_output=True)
        if result.returncode == 0:
            return
        time.sleep(2)
    raise RuntimeError("MariaDB container did not become ready in time.")


def recreate_database(args: argparse.Namespace) -> None:
    sql = (
        f"DROP DATABASE IF EXISTS `{args.database}`; "
        f"CREATE DATABASE `{args.database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    )
    run_command(
        [
            "docker", "exec", args.container,
            "mariadb",
            f"-u{args.user}",
            f"-p{args.password}",
            "-e", sql,
        ]
    )


def import_dump(args: argparse.Namespace) -> int:
    dump_path = Path(args.dump).resolve()
    if not dump_path.exists():
        raise FileNotFoundError(f"Dump file not found: {dump_path}")

    start_or_create_container(args)
    wait_for_mariadb(args)
    recreate_database(args)

    run_command(
        [
            "docker", "exec", "-i", args.container,
            "mariadb",
            f"-u{args.user}",
            f"-p{args.password}",
            args.database,
        ],
        stdin_path=dump_path,
    )

    print(f"Imported {dump_path} into container {args.container} ({args.database})")
    return 0


def main() -> int:
    args = parse_args()
    if args.command == "prepare-db":
        return import_dump(args)
    if args.command == "export":
        return export_posts(args)
    if args.command == "full-export":
        import_dump(args)
        return export_posts(args)
    raise ValueError(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)