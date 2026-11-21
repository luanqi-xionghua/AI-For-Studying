"""资料检索的纯计算层：归一化、来源解析、去重、BM25、查询解析与打开白名单。

这一层不做任何 IO（不联网、不碰 SQLite），单测可以直接喂字典。
"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter
from urllib.parse import quote, urlsplit

# ---------------------------------------------------------------- 常量

SOURCES = {
    "openise": {"label": "OpenISE", "host": "github.com", "priority": 0},
    "sysu": {"label": "SYSU-Exam", "host": "github.com", "priority": 1},
    "arxiv": {"label": "破壁计划", "host": "arxiv.jaison.ink", "priority": 2},
    "arxiv-pkg": {"label": "破壁计划 · 课程包", "host": "arxiv.jaison.ink", "priority": 3},
}
GITHUB_REPOS = {
    "openise": ("changyicheng1234/OpenISE", "main"),
    "sysu": ("sysuexam/SYSU-Exam", "master"),
}
ARXIV_ORIGIN = "https://arxiv.jaison.ink"
OPEN_HOSTS = frozenset({"github.com", "arxiv.jaison.ink"})

DOC_EXT = frozenset("pdf doc docx ppt pptx xls xlsx md txt html htm caj zip rar 7z".split())
IMG_EXT = frozenset("jpg jpeg png bmp webp heic".split())
BINARY_EXT = frozenset("pdf doc docx ppt pptx xls xlsx caj zip rar 7z".split())
SKIP_NAMES = frozenset({"readme.md", "license", "license.md", ".gitkeep"})

FIELD_WEIGHTS = {"title": 3.0, "course": 2.0, "category": 1.2, "path": 1.0}
K1, B = 1.2, 0.75
COURSE_TOKEN_WEIGHT = 0.35
COURSE_FACTOR = {"match": 4.0, "related": 2.0, "empty": 0.85, "other": 0.4}
COVERAGE_GATE = 0.5
QUERY_MAX_CHARS = 100
RESULT_LIMIT_DEFAULT, RESULT_LIMIT_MAX = 30, 50
LIBRARY_HIT_LIMIT = 5
SAME_FILE_MIN_BYTES = 20 * 1024
TITLE_MAX, COURSE_MAX, CATEGORY_MAX, PATH_MAX = 200, 60, 120, 500
MAX_LINKS = 4

FORMAT_RANK = {"pdf": 0, "docx": 1, "pptx": 2, "ppt": 3, "md": 4, "html": 5, "htm": 5,
               "xlsx": 6, "xls": 6, "doc": 7, "txt": 8, "caj": 8, "images": 8,
               "zip": 9, "rar": 9, "7z": 9}
FORMAT_LABEL = {"pdf": "PDF", "doc": "Word", "docx": "Word", "ppt": "PPT", "pptx": "PPT",
                "xls": "Excel", "xlsx": "Excel", "md": "Markdown", "txt": "文本",
                "html": "网页", "htm": "网页", "caj": "CAJ", "zip": "压缩包",
                "rar": "压缩包", "7z": "压缩包", "images": "图片", "jpg": "图片",
                "jpeg": "图片", "png": "图片", "bmp": "图片", "webp": "图片",
                "heic": "图片"}
ARXIV_CATEGORY = {"study_material": "学习资料", "past_exam": "往年试题",
                  "experience": "经验分享"}
ARXIV_SUBCATEGORY = {"lecture": "课件讲义", "summary": "复习总结", "notes": "笔记",
                     "past_exam": "往年试题", "mock_exam": "模拟题",
                     "exam_answer": "试题答案", "textbook_answer": "课后答案"}

COURSE_ALIASES = {
    "线代": "线性代数", "高数": "高等数学", "计网": "计算机网络", "模电": "模拟电路",
    "数电": "数字电路", "概统": "概率论与数理统计", "概率统计": "概率论与数理统计",
    "大物": "大学物理", "史纲": "中国近现代史纲要", "近代史纲": "中国近现代史纲要",
    "中国近代史纲要": "中国近现代史纲要", "马原": "马克思主义基本原理",
    "毛概": "毛泽东思想和中国特色社会主义理论体系概论",
    "习概": "习近平新时代中国特色社会主义思想概论",
    "xi概": "习近平新时代中国特色社会主义思想概论",
    "军理": "军事理论", "程设": "程序设计", "计组": "计算机组成原理",
    "数据库": "数据库系统", "数据库原理": "数据库系统", "数据库系统原理": "数据库系统",
    "数据结构": "数据结构与算法", "思修": "思想道德与法治",
}
NOT_COURSE = frozenset({"未分类", "无", "1", "我", "其他资料", "实验报告模板"})
COURSE_SUFFIX = re.compile(r"(（[^）]*）|\([^)]*\)|[-_][^-_]*$|\d{4}$|[上下]册?$|[一二三四]$|[ⅠⅡ12]$)")
GRADE_DIR = re.compile(r"^大[一二三四五][上下]$")
WEAK_TITLE = re.compile(r"^(img|dsc|p|image|scan|扫描件?|photo|微信图片)?[_\- ]?\d{1,20}$", re.I)
YEAR_RE = re.compile(r"(?<!\d)(19[89]\d|20[0-3]\d)(?!\d)")

INTENTS = (
    ("exam", r"期末|期中|试卷|真题|考试|试题|考卷|卷子|exam|final|midterm",
     r"期末|期中|试卷|真题|考试|试题|考卷|[A-D]卷|样卷|模拟卷|exam|final|midterm|test", 2.0),
    ("answer", r"答案|解析|解答|题解|详解",
     r"答案|解析|解答|题解|详解|参考|sol(ution)?s?|answer", 1.5),
    ("notes", r"笔记|知识点|总结|提纲|重点|大纲|梳理|汇总|复习",
     r"笔记|知识点|总结|提纲|重点|大纲|梳理|汇总|复习|思维导图|notes?", 1.35),
    ("slides", r"ppt|课件|讲义|幻灯片|slides?|lecture",
     r"ppt|课件|讲义|幻灯片|slides?|lecture|第\s*\d+\s*[讲章]", 1.6),
    ("report", r"报告|大作业|实验|作业|project|lab|homework",
     r"报告|大作业|实验|作业|lab|project|homework|hw\d*", 1.25),
)
INTENT_LABEL = {"exam": "考试真题", "answer": "答案解析", "notes": "笔记总结",
                "slides": "课件讲义", "report": "实验与作业"}
INTENT_QUERY_RE = re.compile("|".join("(?:%s)" % item[1] for item in INTENTS), re.I)
_INTENT_TITLE_RES = {key: re.compile(pattern, re.I) for key, _q, pattern, _w in INTENTS}
_INTENT_WEIGHTS = {key: weight for key, _q, _t, weight in INTENTS}

QUERY_FILLER = re.compile(r"课后|题库|资料|复习资料")
BOUNDARY_FILLER = re.compile(
    "(?:%s)|(?:%s)|的|和|与|及|[上下]册?|[a-d]卷|\\d+|[a-z]+"
    % (INTENT_QUERY_RE.pattern, QUERY_FILLER.pattern), re.I)
STOPWORDS = frozenset("的 了 和 与 及 资料 文件 有没有 求 一下 相关 关于 课程 课 中大 中山大学".split())
CONTENT_SPLIT = re.compile(r"[\s,，。.;；:：/\\|、!！?？()（）\[\]【】\"“”‘’]+")

_CJK_RANGE = "\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
_TOKEN_RE = re.compile("([%s]+)|([a-z0-9][a-z0-9.+#]*)" % _CJK_RANGE)


class MaterialError(ValueError):
    """固定错误码 + 固定中文；detail 只允许放状态码、来源名和等待时间。"""

    def __init__(self, code, detail=""):
        self.code = code
        message = MESSAGES.get(code, MESSAGES["MAT_DB"])
        super().__init__("%s：%s%s" % (code, message, ("：" + detail) if detail else ""))


MESSAGES = {
    "MAT_BUSY": "正在同步资料索引，请等这一次完成",
    "MAT_TOO_SOON": "刚刚更新过资料索引，请 1 分钟后再试",
    "MAT_CANCELLED": "已取消同步",
    "MAT_NETWORK": "连不上资料来源，请检查网络后重试",
    "MAT_TIMEOUT": "资料来源响应超时",
    "MAT_RATE_LIMIT": "GitHub 暂时限制了访问次数",
    "MAT_UPSTREAM": "资料来源返回的数据和预期不符，接口可能已变化",
    "MAT_TOO_LARGE": "资料来源返回的数据过大",
    "MAT_QUERY": "搜索词无效：请输入 1–100 个字",
    "MAT_NOT_FOUND": "这条资料已不在索引里",
    "MAT_LINK": "链接不在允许打开的网站范围内",
    "MAT_OPEN": "无法调用系统浏览器",
    "MAT_DB": "本机资料索引读写失败",
}


# ---------------------------------------------------------------- 归一化与分词

def nfkc(text):
    if not isinstance(text, str):
        return ""
    raw = unicodedata.normalize("NFKC", text)
    kept = "".join(ch for ch in raw if unicodedata.category(ch) not in ("Cc", "Cf"))
    return " ".join(kept.split())


def tokenize(text):
    """中文切成相邻二元组，英文数字按词；不依赖分词器。"""
    if not isinstance(text, str) or not text:
        return []
    out = []
    for match in _TOKEN_RE.finditer(nfkc(text).lower()):
        cjk, word = match.group(1), match.group(2)
        if cjk:
            if len(cjk) == 1:
                out.append(cjk)
            else:
                out.extend(cjk[i:i + 2] for i in range(len(cjk) - 1))
        elif word:
            word = word.rstrip(".")
            if word:
                out.append(word)
    return out


def _stem(file_name):
    text = nfkc(file_name)
    dot = text.rfind(".")
    return text[:dot] if dot > 0 else text


def _clip(text, limit):
    text = nfkc(text)
    return text[:limit]


def _has_cjk(text):
    return bool(re.search("[%s]" % _CJK_RANGE, text))


# ---------------------------------------------------------------- 课程

def course_key(name):
    s = nfkc(name).lower().replace(" ", "")
    if not s or s in NOT_COURSE:
        return ""
    if s in COURSE_ALIASES:
        return COURSE_ALIASES[s]
    base = s
    for _ in range(4):
        trimmed = COURSE_SUFFIX.sub("", base)
        if trimmed == base or len(trimmed) < 2:
            break
        base = trimmed
        if base in COURSE_ALIASES:
            return COURSE_ALIASES[base]
    return COURSE_ALIASES.get(base, base)


def course_names_for(key):
    if not key:
        return []
    names = {key}
    for alias, target in COURSE_ALIASES.items():
        if target == key:
            names.add(alias)
    return sorted(names, key=len, reverse=True)


def _course_index(path, source):
    """返回课程所在路径段的序号；取不到返回 -1。"""
    parts = path.split("/")
    if source == "sysu":
        return 0 if len(parts) >= 2 else -1
    for i, seg in enumerate(parts[:-1]):
        if seg == "往届课程" and i + 2 <= len(parts) - 1:
            return i + 1
    for i, seg in enumerate(parts[:-1]):
        if GRADE_DIR.match(seg) and i + 2 <= len(parts) - 1:
            return i + 1
    return -1


def github_course(path, source):
    idx = _course_index(path, source)
    if idx < 0:
        return ""
    return _clip(path.split("/")[idx], COURSE_MAX)


def github_category(path, source):
    idx = _course_index(path, source)
    if idx < 0:
        return ""
    parts = path.split("/")
    return _clip(" / ".join(parts[idx + 1:-1]), CATEGORY_MAX)


def _encode_path(path):
    return "/".join(quote(seg, safe="") for seg in path.split("/"))


def github_blob_url(repo, branch, path):
    return "https://github.com/%s/blob/%s/%s" % (repo, branch, _encode_path(path))


def github_tree_url(repo, branch, path):
    return "https://github.com/%s/tree/%s/%s" % (repo, branch, _encode_path(path))


def arxiv_url(kind, ident):
    try:
        value = int(ident)
    except (TypeError, ValueError):
        raise ValueError("资料编号无效")
    if value <= 0:
        raise ValueError("资料编号无效")
    if kind not in ("material", "package"):
        raise ValueError("资料类型无效")
    return "%s/%s/%d" % (ARXIV_ORIGIN, kind, value)


def validate_open_url(url):
    if not isinstance(url, str) or not url:
        raise MaterialError("MAT_LINK")
    parts = urlsplit(url)
    try:
        port = parts.port
    except ValueError:
        raise MaterialError("MAT_LINK")
    if (parts.scheme != "https" or parts.hostname not in OPEN_HOSTS
            or parts.username or parts.password
            or port not in (None, 443) or parts.fragment):
        raise MaterialError("MAT_LINK")
    return url


# ---------------------------------------------------------------- 来源解析

def is_junk(record):
    if record["size"] < 256:
        return True
    if record["ext"] in BINARY_EXT and record["size"] < 1024:
        return True
    if not record["title"]:
        return True
    return _stem(record["file_name"]).lower() in ("readme", "license")


def _record(source, ident, title, course, category, path, file_name, ext, size,
            url, fetched_at, count=1, year=None, remote_updated=""):
    return {
        "id": ident, "source": source, "title": _clip(title, TITLE_MAX),
        "course": _clip(course, COURSE_MAX), "category": _clip(category, CATEGORY_MAX),
        "path": _clip(path, PATH_MAX), "file_name": _clip(file_name, TITLE_MAX),
        "ext": ext[:10], "size": max(0, int(size or 0)), "count": max(1, int(count or 1)),
        "year": year, "url": url, "remote_updated": remote_updated,
        "fetched_at": fetched_at,
    }


def records_from_github_tree(source, repo, branch, tree, fetched_at):
    if not isinstance(tree, list):
        raise MaterialError("MAT_UPSTREAM", "tree 结构")
    prefix = "oi" if source == "openise" else "sy"
    records = []
    images = {}
    seen = 0
    for node in tree:
        if not isinstance(node, dict) or node.get("type") != "blob":
            continue
        path = node.get("path")
        size = node.get("size")
        if not isinstance(path, str) or not isinstance(size, int):
            raise MaterialError("MAT_UPSTREAM", "tree 结构")
        seen += 1
        parts = path.split("/")
        if (len(parts) < 2 or any(seg.startswith(".") for seg in parts)
                or parts[0] == "scripts" or parts[-1].lower() in SKIP_NAMES or size <= 0):
            continue
        file_name = parts[-1]
        dot = file_name.rfind(".")
        ext = file_name[dot + 1:].lower() if dot > 0 else ""
        if ext in DOC_EXT:
            records.append(_record(
                source, "%s:%s" % (prefix, hashlib.sha1(path.encode("utf-8")).hexdigest()[:16]),
                _stem(file_name), github_course(path, source), github_category(path, source),
                "", file_name, ext, size, github_blob_url(repo, branch, path), fetched_at))
        elif ext in IMG_EXT and source == "sysu":
            images.setdefault("/".join(parts[:-1]), []).append((path, file_name, ext, size))

    folders = 0
    for directory, group in images.items():
        if len(group) == 1:
            path, file_name, ext, size = group[0]
            records.append(_record(
                source, "%s:%s" % (prefix, hashlib.sha1(path.encode("utf-8")).hexdigest()[:16]),
                _stem(file_name), github_course(path, source), github_category(path, source),
                "", file_name, ext, size, github_blob_url(repo, branch, path), fetched_at))
            continue
        folders += 1
        name = directory.rsplit("/", 1)[-1]
        records.append(_record(
            source, "%s:d%s" % (prefix, hashlib.sha1(directory.encode("utf-8")).hexdigest()[:15]),
            "%s（%d 张图片）" % (name, len(group)), github_course(directory, source),
            github_category(directory, source), "", directory, "images",
            sum(item[3] for item in group), github_tree_url(repo, branch, directory),
            fetched_at, count=len(group)))

    records = [item for item in records if not is_junk(item)]
    return records, {"seen": seen, "kept": len(records), "folders": folders}


def records_from_arxiv(kind, items, fetched_at):
    if not isinstance(items, list):
        raise MaterialError("MAT_UPSTREAM", "items 结构")
    records = []
    missing = 0
    for item in items:
        if not isinstance(item, dict):
            missing += 1
            continue
        try:
            ident = int(item.get("id"))
        except (TypeError, ValueError):
            missing += 1
            continue
        file_name = nfkc(item.get("file_name") or "")
        title = nfkc(item.get("title") or "") or _stem(file_name)
        if ident <= 0 or not title:
            missing += 1
            continue
        dot = file_name.rfind(".")
        ext = file_name[dot + 1:].lower() if dot > 0 else ""
        year = item.get("year")
        if not isinstance(year, int) or not 1950 <= year <= 2100:
            year = None
        remote = nfkc(item.get("updated_at") or "")[:40]

        if kind == "package":
            record = _record(
                "arxiv-pkg", "axp:%d" % ident, title, nfkc(item.get("course_name") or ""),
                "课程资料包", nfkc(item.get("description") or ""), file_name,
                ext or "zip", item.get("file_size") or 0, arxiv_url("package", ident),
                fetched_at, remote_updated=remote)
        else:
            category = nfkc(item.get("category") or "")
            sub = nfkc(item.get("sub_category") or "")
            label = ARXIV_CATEGORY.get(category, "")
            sub_label = ARXIV_SUBCATEGORY.get(sub, "")
            label = " ".join(part for part in (label, sub_label) if part)
            if not (ext in DOC_EXT or (ext in IMG_EXT and category == "past_exam")):
                continue
            record = _record(
                "arxiv", "axm:%d" % ident, title, nfkc(item.get("course_name") or ""),
                label, nfkc(item.get("description") or ""), file_name, ext,
                item.get("file_size") or 0, arxiv_url("material", ident), fetched_at,
                year=year, remote_updated=remote)
        if not is_junk(record):
            records.append(record)
    if items and missing / len(items) > 0.2:
        raise MaterialError("MAT_UPSTREAM", "items 结构")
    return records, {"seen": len(items), "kept": len(records), "folders": 0}


# ---------------------------------------------------------------- 合并与索引

def _intent_text(primary):
    text = primary["title"]
    if primary["source"] in ("openise", "sysu") and WEAK_TITLE.match(text):
        parts = primary["path"].split("/")
        if len(parts) >= 2:
            text = text + " " + parts[-2]
    return text


def merge_records(records):
    groups = {}
    order = []
    for record in records:
        if record["source"] == "arxiv-pkg":
            key = record["id"]
        else:
            key = "%s|%d" % (nfkc(record["file_name"]).lower(), record["size"])
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(record)

    entries = []
    for key in order:
        group = groups[key]
        group.sort(key=lambda item: (SOURCES[item["source"]]["priority"], item["id"]))
        primary = group[0]
        course = next((item["course"] for item in group if item["course"]), "")
        year = next((item["year"] for item in group if item["year"]), None)
        if year is None:
            found = YEAR_RE.search(primary["title"])
            year = int(found.group(1)) if found else None
        entries.append({
            "id": primary["id"], "primary": primary, "links": group[:MAX_LINKS],
            "course": course, "course_key": course_key(course), "year": year,
            "intent_text": _intent_text(primary),
        })
    return entries


class Index:
    """不可变索引；一次同步完成后整体替换引用。"""

    __slots__ = ("entries", "by_record", "tf", "lens", "alltok", "postings", "df",
                 "avglen", "n", "course_vocab", "course_names", "by_stem", "by_size",
                 "synced_at", "raw_count")

    def __init__(self):
        self.entries = []
        self.by_record = {}
        self.tf = []
        self.lens = []
        self.alltok = []
        self.postings = {}
        self.df = {}
        self.avglen = {}
        self.n = 0
        self.course_vocab = {}
        self.course_names = []
        self.by_stem = {}
        self.by_size = {}
        self.synced_at = 0
        self.raw_count = 0


def build_index(records, synced_at):
    entries = merge_records(records)
    index = Index()
    index.entries = entries
    index.n = len(entries)
    index.synced_at = synced_at
    index.raw_count = len(records)

    postings = {}
    df = Counter()
    by_stem = {}
    by_size = {}

    for i, entry in enumerate(entries):
        primary = entry["primary"]
        fields = {
            "title": tokenize(primary["title"]),
            "course": tokenize(" ".join(
                [entry["course"], entry["course_key"]] + course_names_for(entry["course_key"]))),
            "category": tokenize(" ".join(
                [primary["category"]] + [item["category"] for item in entry["links"][1:]])),
            "path": tokenize(" ".join(
                [primary["path"]] + [item["path"] for item in entry["links"][1:]])),
        }
        index.tf.append({name: Counter(tokens) for name, tokens in fields.items()})
        index.lens.append({name: len(tokens) for name, tokens in fields.items()})
        merged = set()
        for tokens in fields.values():
            merged.update(tokens)
        index.alltok.append(frozenset(merged))
        for token in merged:
            df[token] += 1
            postings.setdefault(token, []).append(i)
        for link in entry["links"]:
            index.by_record[link["id"]] = i
            stem = _stem(link["file_name"]).lower()
            if stem:
                by_stem.setdefault(stem, []).append(i)
            if link["size"] >= SAME_FILE_MIN_BYTES:
                by_size.setdefault((link["size"], link["ext"]), []).append(i)

    index.postings = postings
    index.df = df
    index.by_stem = by_stem
    index.by_size = by_size
    index.avglen = {
        name: (sum(row[name] for row in index.lens) / index.n if index.n else 1.0) or 1.0
        for name in FIELD_WEIGHTS
    }

    vocab = {}
    for entry in entries:
        raw = nfkc(entry["course"]).lower().replace(" ", "")
        if raw and len(raw) >= 2:
            vocab[raw] = entry["course_key"]
    for key in {entry["course_key"] for entry in entries if entry["course_key"]}:
        vocab[key] = key
    for alias, key in COURSE_ALIASES.items():
        if len(alias) >= 2:
            vocab[alias] = key
    index.course_vocab = vocab
    index.course_names = sorted(vocab, key=len, reverse=True)
    return index


# ---------------------------------------------------------------- 查询解析

def _course_hits_for_run(run, index):
    used = [False] * len(run)
    hits = []
    for name in index.course_names:
        if len(name) > len(run):
            continue
        start = 0
        while True:
            at = run.find(name, start)
            if at < 0:
                break
            if not any(used[at:at + len(name)]):
                for offset in range(at, at + len(name)):
                    used[offset] = True
                hits.append(name)
            start = at + 1
    if not hits:
        return []
    leftover = "".join(ch for i, ch in enumerate(run) if not used[i])
    clean = BOUNDARY_FILLER.sub("", leftover).strip()
    return [(name, index.course_vocab[name]) for name in hits
            if len(name) >= 4 or not clean]


def parse_query(query, index):
    text = nfkc(query)[:QUERY_MAX_CHARS].lower()
    if not tokenize(text):
        raise MaterialError("MAT_QUERY")

    courses = []
    for run in text.split():
        courses.extend(_course_hits_for_run(run, index))

    intents = [key for key, _q, _t, _w in INTENTS if _INTENT_QUERY_RES_ALL.search(text)]

    rest = text
    for name, _key in sorted(courses, key=lambda item: -len(item[0])):
        rest = rest.replace(name, " ")
    rest = INTENT_QUERY_RE.sub(" ", rest)
    rest = QUERY_FILLER.sub(" ", rest)
    content = [part for part in CONTENT_SPLIT.split(rest)
               if part and part not in STOPWORDS and (_has_cjk(part) or len(part) >= 2)]

    tokens = list(dict.fromkeys(tokenize(text)))
    course_tokens = set()
    for name, _key in courses:
        course_tokens.update(tokenize(name))
    weights = {token: (COURSE_TOKEN_WEIGHT if token in course_tokens else 1.0)
               for token in tokens}
    return {"text": text, "tokens": tokens, "weights": weights, "courses": courses,
            "intents": intents, "content": content}


_INTENT_QUERY_RES_ALL = re.compile("|".join("(?:%s)" % item[1] for item in INTENTS), re.I)


# ---------------------------------------------------------------- 打分

def _idf(index, token, total):
    df = index.df.get(token, 0) if index is not None else 0
    if index is None or not df:
        return math.log(1 + total) if total else 1.0
    return math.log(1 + (index.n - df + 0.5) / (df + 0.5))


def _bm25(index, row, tokens, weights):
    score = 0.0
    for field, weight in FIELD_WEIGHTS.items():
        length = index.lens[row][field] or 0
        avg = index.avglen[field] or 1.0
        norm = 1 - B + B * length / avg
        counter = index.tf[row][field]
        for token in tokens:
            count = counter.get(token)
            if not count:
                continue
            df = index.df.get(token, 0)
            if not df:
                continue
            idf = math.log(1 + (index.n - df + 0.5) / (df + 0.5))
            score += (weights.get(token, 1.0) * weight * idf * count * (K1 + 1)
                      / (count + K1 * norm))
    return score


def _covered(term, tokens):
    parts = tokenize(term)
    if not parts:
        return False
    return sum(1 for part in parts if part in tokens) / len(parts) >= 0.5


def _coverage(parsed, tokens, course_keys):
    terms = [("course", text, key) for text, key in parsed["courses"]]
    terms += [("content", text, "") for text in parsed["content"]]
    if terms:
        hits = 0
        for kind, text, key in terms:
            if kind == "course":
                if key in course_keys or _covered(text, tokens):
                    hits += 1
            elif _covered(text, tokens):
                hits += 1
        return hits / len(terms)
    for key in course_keys:
        if key in {k for _t, k in parsed["courses"]}:
            return 1.0
    if any(_INTENT_TITLE_RES[key].search(" ".join(sorted(tokens))) for key in parsed["intents"]):
        return 1.0
    return 1.0 if set(parsed["tokens"]) & set(tokens) else 0.0


def _course_factor(parsed, course_keys):
    if not parsed["courses"]:
        return 1.0
    keys = {key for _text, key in parsed["courses"]}
    if course_keys & keys:
        return COURSE_FACTOR["match"]
    if not course_keys:
        return COURSE_FACTOR["empty"]
    for own in course_keys:
        for text, key in parsed["courses"]:
            if own in key or key in own:
                return COURSE_FACTOR["related"]
            if text and text in own:
                return COURSE_FACTOR["related"]
    return COURSE_FACTOR["other"]


def _intent_factor(parsed, text, ext):
    factor = 1.0
    hits = []
    for key in parsed["intents"]:
        if _INTENT_TITLE_RES[key].search(text) or (key == "slides" and ext in ("ppt", "pptx")):
            factor *= _INTENT_WEIGHTS[key]
            hits.append(key)
    return factor, hits


def _format(ext):
    return FORMAT_LABEL.get(ext, ext.upper() if ext else "文件")


def _link(record):
    return {"id": record["id"], "source": record["source"],
            "label": SOURCES[record["source"]]["label"],
            "host": SOURCES[record["source"]]["host"]}


# ---------------------------------------------------------------- 文档库

def _doc_course_keys(name):
    text = nfkc(name).lower()
    keys = set()
    for run in text.split():
        for _text, key in _course_hits_for_run(run, _DocVocab):
            keys.add(key)
    return keys


class _DocVocab:
    course_names = []
    course_vocab = {}


def _bind_doc_vocab(index):
    _DocVocab.course_names = index.course_names if index is not None else []
    _DocVocab.course_vocab = index.course_vocab if index is not None else {}


def library_hits(parsed, index, docs):
    _bind_doc_vocab(index)
    if not docs:
        return []
    total = index.n if index is not None else 0
    scored = []
    for item in docs:
        name = item.get("name") or ""
        tokens = set(tokenize(name + " " + " ".join(item.get("tags") or [])))
        keys = _doc_course_keys(name)
        coverage = _coverage(parsed, tokens, keys)
        if coverage < COVERAGE_GATE:
            continue
        score = sum(_idf(index, token, total) for token in parsed["tokens"] if token in tokens)
        if score <= 0:
            continue
        factor, _hits = _intent_factor(parsed, nfkc(name), "pdf")
        score *= _course_factor(parsed, keys) * factor * (0.5 + 0.5 * coverage)
        scored.append((-round(score, 6), -(item.get("lastOpenedAt") or 0), name, score, item))
    scored.sort()
    return [{"docId": item["id"], "name": item["name"],
             "kind": item.get("kind") or "pdf", "score": round(score, 2),
             "sourceMissing": bool(item.get("sourceMissing"))}
            for _neg, _open, _name, score, item in scored[:LIBRARY_HIT_LIMIT]]


def owned_index(docs):
    by_stem = {}
    by_size = {}
    for item in docs or []:
        stem = _stem(item.get("name") or "").lower()
        if stem:
            by_stem.setdefault(stem, item)
        size = item.get("size")
        if isinstance(size, int) and size >= SAME_FILE_MIN_BYTES:
            # Word 在文档库里是原 docx/doc 的名字和大小，按真实后缀而不是 kind 比较
            path = nfkc(item.get("path") or "")
            dot = path.rfind(".")
            ext = path[dot + 1:].lower() if dot > 0 else ""
            ext = ext or (item.get("kind") or "")
            by_size.setdefault((size, ext), item)
    return by_stem, by_size


def owned_of(entry, by_stem, by_size):
    for record in entry["links"]:
        stem = _stem(record["file_name"]).lower()
        found = by_stem.get(stem) if stem else None
        if found:
            return {"docId": found["id"], "name": found["name"], "match": "name"}
    for record in entry["links"]:
        if record["size"] >= SAME_FILE_MIN_BYTES:
            found = by_size.get((record["size"], record["ext"]))
            if found:
                return {"docId": found["id"], "name": found["name"], "match": "size"}
    return None


# ---------------------------------------------------------------- 检索

def search(index, parsed, *, limit, library, partial=False):
    bind = max(1, min(RESULT_LIMIT_MAX, int(limit or RESULT_LIMIT_DEFAULT)))
    docs = list(library or [])
    lib = library_hits(parsed, index, docs)

    base = {
        "normalized": parsed["text"],
        "courses": [{"text": text, "key": key} for text, key in parsed["courses"]],
        "intents": list(parsed["intents"]),
        "content": list(parsed["content"]),
        "library": lib,
    }
    if index is None:
        return dict(base, found=bool(lib), reason="" if lib else "empty-index",
                    results=[], total=0, indexSyncedAt=0, hints=[])

    tokens = [token for token in parsed["tokens"] if token in index.postings]
    candidates = set()
    for token in tokens:
        candidates.update(index.postings[token])

    by_stem, by_size = owned_index(docs)
    scored = []
    for row in candidates:
        entry = index.entries[row]
        coverage = _coverage(parsed, index.alltok[row], {entry["course_key"]} - {""})
        if coverage < COVERAGE_GATE:
            continue
        factor, hits = _intent_factor(parsed, entry["intent_text"], entry["primary"]["ext"])
        score = (_bm25(index, row, parsed["tokens"], parsed["weights"])
                 * _course_factor(parsed, {entry["course_key"]} - {""})
                 * factor * (0.5 + 0.5 * coverage))
        if score <= 0:
            continue
        scored.append((score, coverage, hits, entry))

    scored.sort(key=lambda item: (-round(item[0], 6),
                                  FORMAT_RANK.get(item[3]["primary"]["ext"], 10),
                                  len(item[3]["primary"]["title"]), item[3]["id"]))

    seen_title = set()
    seen_file = set()
    picked = []
    for score, coverage, hits, entry in scored:
        title_key = (nfkc(entry["primary"]["title"]).lower(), entry["course_key"])
        ext = entry["primary"]["ext"]
        size_key = None
        if entry["primary"]["size"] >= SAME_FILE_MIN_BYTES and entry["course_key"]:
            size_key = (entry["course_key"], entry["primary"]["size"], ext)
        if title_key in seen_title or (size_key and size_key in seen_file):
            continue
        seen_title.add(title_key)
        if size_key:
            seen_file.add(size_key)
        primary = entry["primary"]
        picked.append({
            "id": entry["id"], "title": primary["title"], "course": entry["course"],
            "courseKey": entry["course_key"], "category": primary["category"],
            "ext": ext, "format": _format(ext), "size": primary["size"],
            "count": primary["count"], "year": entry["year"],
            "source": primary["source"], "url": primary["url"],
            "links": [_link(record) for record in entry["links"]],
            "owned": owned_of(entry, by_stem, by_size),
            "score": round(score, 2), "coverage": round(coverage, 2),
            "intents": list(hits),
        })

    hints = []
    if parsed["intents"] and not parsed["courses"] and not parsed["content"]:
        hints.append("intent-only")
    if partial:
        hints.append("partial")

    reason = ""
    if not picked:
        reason = "low-coverage" if candidates else "no-match"
    return dict(base, found=bool(picked or lib), reason=reason, results=picked[:bind],
                total=len(picked), indexSyncedAt=index.synced_at, hints=hints)
