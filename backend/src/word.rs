//! Word 文档（.docx / 老式 .doc）：加入文档库时先转成 PDF，之后完全按 PDF 阅读。
//!
//! 转换依次尝试这台电脑上的 Microsoft Word、WPS 文字（都经 PowerShell 走 COM 自动化）和 LibreOffice。
//! 转好的 PDF 存在应用数据目录的 `converted/<文档 id>.pdf`，旁边的 `<文档 id>.src` 记着转换时原文件的
//! 大小和修改时间；原文件不动。打开时原文件对不上（改过、换过）就重新转；原文件不在了但缓存还在，照样能读。

use crate::db::{Document, Result};
use std::{fs, io::Read, path::{Path, PathBuf}, sync::Mutex, time::{Duration, UNIX_EPOCH}};

/// 单个 Word 文件的大小上限。
pub const MAX_WORD_BYTES: u64 = 128 * 1024 * 1024;
/// 一个转换程序最长等多久：Word 第一次启动、几百页的文档都要时间；卡住（比如弹出了对话框）就放弃。
#[cfg_attr(not(windows), allow(dead_code))]
const TIMEOUT: Duration = Duration::from_secs(180);
/// 同一时间只转一份：几个 Word / WPS 实例同时开会互相抢，LibreOffice 共用一个配置目录时后一个直接失败。
#[cfg_attr(not(windows), allow(dead_code))]
static CONVERT_LOCK: Mutex<()> = Mutex::new(());

const ZIP: &[u8] = b"PK\x03\x04";
const OLE: &[u8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

pub fn is_word_path(path: &Path) -> bool {
    matches!(path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase().as_str(), "doc" | "docx")
}

fn is_docx(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("docx"))
}

/// 文件头像不像 Word 能打开的文档：.docx 是 zip；.doc 是 OLE 复合文档（加了密码的 .docx 也是）；
/// 有些 .doc 其实是 RTF、网页（HTML / MHTML）或 Word 2003 XML，Word、WPS、LibreOffice 都能打开。
pub fn looks_like_word(header: &[u8]) -> bool {
    let text = header.strip_prefix(b"\xEF\xBB\xBF".as_slice()).unwrap_or(header);
    header.starts_with(ZIP) || header.starts_with(OLE)
        || text.starts_with(b"{\\rtf") || text.starts_with(b"<") || text.starts_with(b"MIME-Ver")
}

pub fn check_header(path: &Path) -> Result<()> {
    let mut header = [0u8; 8];
    fs::File::open(path).and_then(|mut file| file.read_exact(&mut header)).map_err(|_| "Word 文件不完整或无法读取")?;
    if !looks_like_word(&header) { return Err("文件不是有效的 Word 文档（.doc / .docx）".into()); }
    // .docx 本该是 zip；是 OLE 复合文档，说明设了打开密码（或权限保护）。转换程序会弹出密码框卡住，直接说明。
    if is_docx(path) && header.starts_with(OLE) {
        return Err("这份 Word 文档设了打开密码：请先在 Word 里去掉密码（文件 → 信息 → 保护文档 → 用密码进行加密，清空后保存），再加入".into());
    }
    Ok(())
}

fn check_size(path: &Path) -> Result<()> {
    let size = fs::metadata(path).map_err(|_| "无法读取 Word 文件")?.len();
    if size > MAX_WORD_BYTES { return Err("Word 文档超过 128 MB，无法转换".into()); }
    Ok(())
}

/// 原文件的指纹：大小 + 修改时间（毫秒）。比只比较修改时间先后稳：从别处复制来的旧文件也能认出来。
fn stamp(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis();
    Some(format!("{} {modified}", metadata.len()))
}

/// 只接受文档库生成的 id（字母、数字和连字符），不让 id 拼出别的路径。
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

/// 转好的 PDF 放在哪。
pub fn cache_path(converted: &Path, id: &str) -> Option<PathBuf> {
    valid_id(id).then(|| converted.join(format!("{id}.pdf")))
}

fn stamp_path(converted: &Path, id: &str) -> Option<PathBuf> {
    valid_id(id).then(|| converted.join(format!("{id}.src")))
}

fn temp_path(converted: &Path) -> PathBuf {
    converted.join(format!("tmp-{}.pdf", uuid::Uuid::new_v4()))
}

/// 这一批里的一份 Word：原文件（与文档库记录的路径写法一致）、转好的临时 PDF、转换前原文件的指纹。
pub struct Prepared {
    pub source: String,
    pub pdf: PathBuf,
    stamp: Option<String>,
}

/// 导入前先把这一批里的 Word 文档转好（放在临时文件里）。任何一份转不了，整批都不导入。
/// 打不开的路径交给文档库的导入去报错，这里跳过。
pub fn prepare(paths: &[String], converted: &Path) -> Result<Vec<Prepared>> {
    if paths.len() > 200 { return Err("一次最多导入 200 份文档".into()); }
    let mut prepared: Vec<Prepared> = Vec::new();
    for path in paths {
        let path = Path::new(path);
        if !is_word_path(path) { continue; }
        let Ok(source) = fs::canonicalize(path) else { continue };
        let key = source.to_string_lossy().into_owned();
        if prepared.iter().any(|item| item.source == key) { continue; }
        let name = source.file_name().and_then(|s| s.to_str()).unwrap_or("Word 文档").to_owned();
        let fingerprint = stamp(&source);
        let result = check_header(&source)
            .and_then(|_| check_size(&source))
            .and_then(|_| fs::create_dir_all(converted).map_err(|e| e.to_string()))
            .map(|_| temp_path(converted))
            .and_then(|pdf| match convert(&source, &pdf) {
                Ok(()) => Ok(pdf),
                Err(error) => { let _ = fs::remove_file(&pdf); Err(error) }
            });
        match result {
            Ok(pdf) => prepared.push(Prepared { source: key, pdf, stamp: fingerprint }),
            Err(error) => { discard(&prepared); return Err(format!("《{name}》无法转成 PDF：{error}")); }
        }
    }
    Ok(prepared)
}

/// 导入成功后，把临时 PDF 换到文档 id 名下（同一份文档再导入会覆盖旧的），记下原文件指纹。
pub fn commit(prepared: Vec<Prepared>, documents: &[Document], converted: &Path) {
    for item in prepared {
        let Some(doc) = documents.iter().find(|doc| doc.kind == "word" && doc.path == item.source) else {
            let _ = fs::remove_file(&item.pdf);
            continue;
        };
        match (cache_path(converted, &doc.id), stamp_path(converted, &doc.id)) {
            (Some(pdf), Some(record)) if fs::rename(&item.pdf, &pdf).is_ok() => match &item.stamp {
                Some(stamp) => { let _ = fs::write(&record, stamp); }
                None => { let _ = fs::remove_file(&record); }
            },
            _ => { let _ = fs::remove_file(&item.pdf); }
        }
    }
}

/// 导入失败：转好的临时 PDF 都删掉。
pub fn discard(prepared: &[Prepared]) {
    for item in prepared { let _ = fs::remove_file(&item.pdf); }
}

/// 从文档库移除时，转好的 PDF 和指纹一起删掉。
pub fn forget(converted: &Path, id: &str) {
    for path in [cache_path(converted, id), stamp_path(converted, id)].into_iter().flatten() { let _ = fs::remove_file(path); }
}

/// 启动时打扫 converted 文件夹：上次没转完（程序被关掉）留下的临时文件；
/// 给了文档库里 Word 文档的 id 时，再清掉已移除文档（或移除时正好在转换）留下的缓存。
pub fn clean(converted: &Path, keep: Option<&[String]>) {
    let Ok(entries) = fs::read_dir(converted) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let stale = name.starts_with("tmp-") || match (keep, name.rsplit_once('.')) {
            (Some(keep), Some((id, "pdf" | "src"))) => !keep.iter().any(|kept| kept == id),
            _ => false,
        };
        if !stale { continue; }
        let path = entry.path();
        if path.is_dir() { let _ = fs::remove_dir_all(&path); } else { let _ = fs::remove_file(&path); }
    }
}

/// 阅读时用的 PDF：缓存在、且原文件没变就直接用；缓存没了或原文件变了就重新转。
/// 原文件不在了，或者重新转失败（比如转换软件卸载了），有缓存就先用缓存，至少能读。
pub fn ensure(doc: &Document, converted: &Path) -> Result<PathBuf> {
    let (Some(target), Some(record)) = (cache_path(converted, &doc.id), stamp_path(converted, &doc.id)) else {
        return Err("文档编号无效".into());
    };
    let source = Path::new(&doc.path);
    let current = stamp(source);
    let cached = target.is_file();
    if cached {
        match &current {
            None => return Ok(target),
            Some(now) if fs::read_to_string(&record).is_ok_and(|saved| saved == *now) => return Ok(target),
            _ => {}
        }
    } else if current.is_none() {
        return Err("找不到原来的 Word 文件，可能已移动或删除".into());
    }
    let fresh = check_header(source)
        .and_then(|_| check_size(source))
        .and_then(|_| fs::create_dir_all(converted).map_err(|e| e.to_string()))
        .and_then(|_| {
            let temp = temp_path(converted);
            let result = convert(source, &temp).and_then(|_| fs::rename(&temp, &target).map_err(|e| e.to_string()));
            if result.is_err() { let _ = fs::remove_file(&temp); }
            result
        });
    match fresh {
        Ok(()) => {
            if let Some(now) = current { let _ = fs::write(&record, now); }
            Ok(target)
        }
        Err(_) if cached => Ok(target),
        Err(error) => Err(format!("Word 文档无法转成 PDF：{error}")),
    }
}

/// 去掉 Windows 规范化路径的 `\\?\` 前缀：Word、WPS、LibreOffice 都不认这种写法。
pub fn plain_path(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") { return format!(r"\\{rest}"); }
    if let Some(rest) = text.strip_prefix(r"\\?\") { return rest.to_owned(); }
    text
}

/// 本地路径写成 file:/// 网址（LibreOffice 的配置目录参数要这种写法）。
#[cfg_attr(not(windows), allow(dead_code))]
pub fn file_url(path: &Path) -> String {
    let text = plain_path(path).replace('\\', "/");
    let mut url = String::from(if text.starts_with("//") { "file:" } else { "file:///" });
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"/._~-:".contains(&byte) { url.push(byte as char); }
        else { url.push_str(&format!("%{byte:02X}")); }
    }
    url
}

/// Word / WPS 脚本的输出（每行「程序名<TAB>原因」）整理成给用户看的一句话。
#[cfg_attr(not(windows), allow(dead_code))]
fn office_problems(output: &str) -> Option<String> {
    let lines: Vec<String> = output.trim_start_matches('\u{feff}').lines().map(str::trim).filter(|line| !line.is_empty())
        .map(|line| match line.split_once('\t') {
            Some((name, "-")) => format!("{name} 没有生成 PDF"),
            Some((name, "kaizhi:open")) => format!("{name} 打不开这份文档"),
            Some((name, reason)) => format!("{name}：{}", reason.trim()),
            None => line.to_owned(),
        })
        .collect();
    (!lines.is_empty()).then(|| lines.join("；"))
}

#[cfg(windows)]
fn convert(source: &Path, target: &Path) -> Result<()> {
    let _guard = CONVERT_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    windows::convert(source, target)
}

#[cfg(not(windows))]
fn convert(_source: &Path, _target: &Path) -> Result<()> { Err("Word 文档只能在 Windows 版开智里转换".into()) }

/// 依次试 Word、WPS（新版 KWps、旧版 Wps，同一个 WPS 只试一次）。写到 converted\word-to-pdf.ps1 再用 -File 运行。
/// 只用 ASCII：Windows PowerShell 5.1 读不带 BOM 的脚本按系统代码页解码。
#[cfg_attr(not(windows), allow(dead_code))]
const OFFICE_SCRIPT: &str = r##"# Word / WPS -> PDF for Kaizhi. Written by the app; paths come in through environment variables.
# Exit codes: 0 converted; 3 neither Word nor WPS is installed; 4 failed (one "name<TAB>reason" line per program on stdout).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
$source = $env:KAIZHI_WORD_SOURCE
$target = $env:KAIZHI_WORD_TARGET
$pidFile = $env:KAIZHI_WORD_PIDS
$found = $false
$converted = $false
$wpsTried = $false
$problems = @()
function Get-Reason($record) { try { return ($record.Exception.GetBaseException().Message -replace '\s+', ' ').Trim() } catch { return "$record" } }
function Get-Code($record) { try { return ('{0:X8}' -f $record.Exception.GetBaseException().HResult) } catch { return '' } }
foreach ($progId in @('Word.Application', 'KWps.Application', 'Wps.Application')) {
  $isWord = ($progId -eq 'Word.Application')
  if ((-not $isWord) -and $wpsTried) { continue }
  if ($null -eq [Type]::GetTypeFromProgID($progId)) { continue }
  $found = $true
  if (-not $isWord) { $wpsTried = $true }
  $label = 'WPS'
  if ($isWord) { $label = 'Word' }
  $app = $null
  $doc = $null
  $shared = $false
  $ours = $true
  $oldAlerts = $null
  $oldSecurity = $null
  Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
  try {
    # Remember the Word / WPS processes this run starts, so the app can end them if the conversion hangs.
    $before = @(Get-Process -Name WINWORD, wps -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    $app = New-Object -ComObject $progId
    $started = @(Get-Process -Name WINWORD, wps -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
    if ($pidFile) { Set-Content -LiteralPath $pidFile -Value ($started -join ' ') -Encoding Ascii }
    # WPS (or Word taken over by WPS) may hand back the instance the user already has open:
    # then keep its window as it is, restore its settings afterwards and never close documents that were open before.
    $open = @()
    try { foreach ($d in $app.Documents) { $open += $d.FullName } } catch {}
    $shared = ($open.Count -gt 0)
    if (-not $shared) { try { $app.Visible = $false } catch {} }
    try { $oldAlerts = $app.DisplayAlerts; $app.DisplayAlerts = 0 } catch {}
    try { $oldSecurity = $app.AutomationSecurity; $app.AutomationSecurity = 3 } catch {}
    # Read-only, with a password that never matches: unprotected files open normally,
    # protected ones fail at once instead of showing a password box.
    try { $doc = $app.Documents.Open($source, $false, $true, $false, 'kaizhi-no-password', 'kaizhi-no-password') }
    catch {
      $code = Get-Code $_
      if ($isWord -or (@('8002000E', '8002000F', '80020003', '80020004', '80020005') -notcontains $code)) { throw }
      $doc = $app.Documents.Open($source, $false, $true)
    }
    if ($null -eq $doc) { throw 'kaizhi:open' }
    try { if ($open -contains $doc.FullName) { $ours = $false } } catch {}
    $saved = $false
    # 17 = PDF; heading bookmarks (1) become the outline in the PDF reader.
    try { $doc.ExportAsFixedFormat($target, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $true, $false); $saved = $true } catch {}
    if (-not $saved) { try { $doc.ExportAsFixedFormat($target, 17); $saved = $true } catch {} }
    if (-not $saved) { try { $doc.SaveAs2($target, 17); $saved = $true } catch {} }
    if (-not $saved) { try { $doc.ExportPdf($target); $saved = $true } catch {} }
    if (-not $saved) { $doc.SaveAs($target, 17) }
    $item = Get-Item -LiteralPath $target -ErrorAction SilentlyContinue
    if (($null -ne $item) -and ($item.Length -gt 0)) { $converted = $true } else { $problems += "$label`t-" }
  } catch {
    $problems += ("{0}`t{1}" -f $label, (Get-Reason $_))
  } finally {
    if ($null -ne $doc) {
      if ($ours) { try { $doc.Close(0) } catch {} }
      try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) } catch {}
    }
    if ($null -ne $app) {
      if ($shared) {
        try { if ($null -ne $oldAlerts) { $app.DisplayAlerts = $oldAlerts } } catch {}
        try { if ($null -ne $oldSecurity) { $app.AutomationSecurity = $oldSecurity } } catch {}
      } else {
        try { if ($app.Documents.Count -eq 0) { $app.Quit(0) } } catch {}
      }
      try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) } catch {}
    }
  }
  if ($converted) { exit 0 }
}
if (-not $found) { exit 3 }
[Console]::Out.Write(($problems -join "`n"))
exit 4
"##;

#[cfg(windows)]
mod windows {
    use super::*;
    use std::{os::windows::process::CommandExt, process::{Command, Stdio}, time::Instant};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    enum Failure { Missing, Failed(String) }

    pub fn convert(source: &Path, target: &Path) -> Result<()> {
        let office = match run_office(source, target) {
            Ok(()) if is_pdf(target) => return Ok(()),
            Ok(()) => Failure::Failed("Word / WPS 没有生成有效的 PDF".into()),
            Err(failure) => failure,
        };
        let _ = fs::remove_file(target);
        let libre = match find_soffice() {
            None => Failure::Missing,
            Some(soffice) => match run_libreoffice(&soffice, source, target) {
                Ok(()) if is_pdf(target) => return Ok(()),
                Ok(()) => Failure::Failed("LibreOffice 没有生成有效的 PDF".into()),
                Err(error) => Failure::Failed(error),
            },
        };
        let _ = fs::remove_file(target);
        Err(match (office, libre) {
            (Failure::Missing, Failure::Missing) => "这台电脑上没有找到 Microsoft Word、WPS 或 LibreOffice。装其中一个（LibreOffice 免费）后再加入。".into(),
            (Failure::Failed(error), Failure::Missing) | (Failure::Missing, Failure::Failed(error)) => error,
            (Failure::Failed(office), Failure::Failed(libre)) => format!("{office}；{libre}"),
        })
    }

    fn is_pdf(path: &Path) -> bool {
        let mut header = [0u8; 5];
        fs::File::open(path).and_then(|mut file| file.read_exact(&mut header)).is_ok() && &header == b"%PDF-"
    }

    fn system32(program: &str) -> PathBuf {
        std::env::var_os("SystemRoot")
            .map(|root| PathBuf::from(root).join("System32").join(program))
            .filter(|path| path.is_file())
            .unwrap_or_else(|| PathBuf::from(Path::new(program).file_name().unwrap_or_default()))
    }

    /// 结束一个进程和它的子进程（LibreOffice 的 soffice.exe 只是启动器，真正干活的 soffice.bin 是它的子进程）。
    fn kill_tree(pid: u32) {
        let pid = pid.to_string();
        let _ = Command::new(system32("taskkill.exe")).args(["/PID", pid.as_str(), "/T", "/F"])
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW).status();
    }

    fn run_office(source: &Path, target: &Path) -> std::result::Result<(), Failure> {
        let folder = target.parent().unwrap_or(Path::new("."));
        let script = folder.join("word-to-pdf.ps1");
        if fs::read_to_string(&script).ok().as_deref() != Some(OFFICE_SCRIPT) {
            fs::write(&script, OFFICE_SCRIPT).map_err(|e| Failure::Failed(format!("无法写入转换脚本：{e}")))?;
        }
        let pids = target.with_extension("pids");
        let mut command = Command::new(system32(r"WindowsPowerShell\v1.0\powershell.exe"));
        command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(plain_path(&script))
            .env("KAIZHI_WORD_SOURCE", plain_path(source))
            .env("KAIZHI_WORD_TARGET", plain_path(target))
            .env("KAIZHI_WORD_PIDS", plain_path(&pids))
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW);
        // 卡住时：PowerShell 连同子进程一起结束，再结束这次启动的 Word / WPS（它们由 COM 拉起，不在 PowerShell 的进程树里）。
        let kill_office = || {
            let text = fs::read_to_string(&pids).unwrap_or_default();
            for pid in text.split_whitespace().filter_map(|id| id.parse::<u32>().ok()) { kill_tree(pid); }
        };
        let result = run(command, "Word / WPS", &kill_office);
        let _ = fs::remove_file(&pids);
        let (code, output) = result.map_err(Failure::Failed)?;
        match code {
            0 => Ok(()),
            3 => Err(Failure::Missing),
            _ => Err(Failure::Failed(office_problems(&output).unwrap_or_else(|| format!("Word / WPS 转换出错（退出码 {code}）")))),
        }
    }

    /// LibreOffice：常见安装位置，再找 PATH。
    fn find_soffice() -> Option<PathBuf> {
        let installed = ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"].into_iter()
            .filter_map(|key| std::env::var_os(key))
            .map(|root| PathBuf::from(root).join(r"LibreOffice\program"));
        let on_path: Vec<PathBuf> = std::env::var_os("PATH").map(|paths| std::env::split_paths(&paths).collect()).unwrap_or_default();
        installed.chain(on_path).map(|folder| folder.join("soffice.exe")).find(|path| path.is_file())
    }

    fn run_libreoffice(soffice: &Path, source: &Path, target: &Path) -> std::result::Result<(), String> {
        // 每次转换用自己的输出目录；配置目录固定一个，免得每次都重新初始化，也不和用户正开着的 LibreOffice 抢。
        let work = target.with_extension("lo");
        fs::create_dir_all(&work).map_err(|e| e.to_string())?;
        let profile = target.parent().unwrap_or(Path::new(".")).join("libreoffice-profile");
        let mut command = Command::new(soffice);
        command.args(["--headless", "--norestore", "--nolockcheck", "--nodefault", "--nologo"])
            .arg(format!("-env:UserInstallation={}", file_url(&profile)))
            .args(["--convert-to", "pdf", "--outdir"])
            .arg(plain_path(&work))
            .arg(plain_path(source))
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        // LibreOffice 输出的文件名是「原文件名去掉最后一个扩展名 + .pdf」（报告.v2.docx → 报告.v2.pdf）。
        let mut name = source.file_stem().map(|s| s.to_os_string()).unwrap_or_default();
        name.push(".pdf");
        let produced = work.join(name);
        let result = match run(command, "LibreOffice", &|| {}) {
            Ok(_) if produced.is_file() => fs::rename(&produced, target).map_err(|e| e.to_string()),
            Ok(_) => Err("LibreOffice 没有生成 PDF（文档可能损坏或设了密码）".into()),
            Err(error) => Err(error),
        };
        let _ = fs::remove_dir_all(&work);
        result
    }

    /// 跑一个子进程，最多等 TIMEOUT；返回退出码和标准输出（PowerShell 的 CLIXML 进度信息不要）。
    /// 超时就连同子进程一起结束，再调用 on_timeout 收拾进程树以外的东西。
    fn run(mut command: Command, program: &str, on_timeout: &dyn Fn()) -> std::result::Result<(i32, String), String> {
        let mut child = command.spawn().map_err(|e| format!("无法启动 {program}：{e}"))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let out = std::thread::spawn(move || read_all(stdout));
        let err = std::thread::spawn(move || read_all(stderr));
        let started = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if started.elapsed() <= TIMEOUT => std::thread::sleep(Duration::from_millis(200)),
                outcome => {
                    kill_tree(child.id());
                    let _ = child.kill();
                    let _ = child.wait();
                    on_timeout();
                    return Err(match outcome {
                        Err(error) => format!("{program} 转换出错：{error}"),
                        _ => format!("{program} 转换超过 {} 秒仍未完成，已放弃", TIMEOUT.as_secs()),
                    });
                }
            }
        };
        let output = out.join().unwrap_or_default();
        let errors = err.join().unwrap_or_default();
        let output = if output.trim().is_empty() && !errors.contains("#< CLIXML") { errors } else { output };
        Ok((status.code().unwrap_or(-1), output.trim_start_matches('\u{feff}').trim().to_owned()))
    }

    fn read_all<R: Read>(source: Option<R>) -> String {
        let mut bytes = Vec::new();
        if let Some(mut source) = source { let _ = source.read_to_end(&mut bytes); }
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder() -> PathBuf {
        let root = std::env::temp_dir().join(format!("phydog-word-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn word_doc(id: &str, path: &Path) -> Document {
        Document { id: id.into(), name: "课程报告.docx".into(), kind: "word".into(), path: path.to_string_lossy().into_owned(), size: 0, modified_at: 0,
            added_at: 0, last_opened_at: 0, progress: 0.0, page: 1, page_count: 1, tags: vec![], starred: false }
    }

    #[test]
    fn word_headers_and_extensions() {
        assert!(looks_like_word(b"PK\x03\x04\x14\x00\x06\x00"));
        assert!(looks_like_word(OLE));
        assert!(looks_like_word(b"{\\rtf1\\ansi"));
        assert!(looks_like_word(b"<html xm") && looks_like_word(b"\xEF\xBB\xBF<?xml") && looks_like_word(b"MIME-Version: 1.0"));
        assert!(!looks_like_word(b"%PDF-1.7"));
        assert!(!looks_like_word(b"hello wo"));
        assert!(is_word_path(Path::new("报告.DOCX")) && is_word_path(Path::new("旧稿.doc")));
        assert!(!is_word_path(Path::new("note.md")) && !is_word_path(Path::new("docx")));
    }

    #[test]
    fn encrypted_docx_is_explained_up_front() {
        let root = folder();
        let locked = root.join("加密.docx");
        let old = root.join("旧稿.doc");
        fs::write(&locked, OLE).unwrap();
        fs::write(&old, OLE).unwrap();
        assert!(check_header(&locked).unwrap_err().contains("密码"));
        assert!(check_header(&old).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cache_names_stay_inside_the_folder() {
        let root = Path::new("converted");
        assert_eq!(cache_path(root, "0b9c-4f"), Some(root.join("0b9c-4f.pdf")));
        assert_eq!(stamp_path(root, "0b9c-4f"), Some(root.join("0b9c-4f.src")));
        assert_eq!(cache_path(root, "../evil"), None);
        assert_eq!(cache_path(root, ""), None);
        assert_eq!(cache_path(root, "a/b"), None);
    }

    #[test]
    fn paths_for_office_programs() {
        assert_eq!(plain_path(Path::new(r"\\?\C:\书\报告.docx")), r"C:\书\报告.docx");
        assert_eq!(plain_path(Path::new(r"\\?\UNC\server\share\a.doc")), r"\\server\share\a.doc");
        assert_eq!(plain_path(Path::new(r"C:\a b\c.doc")), r"C:\a b\c.doc");
        assert_eq!(file_url(Path::new(r"C:\Users\张三\lo profile")), "file:///C:/Users/%E5%BC%A0%E4%B8%89/lo%20profile");
    }

    #[test]
    fn office_script_is_ascii_and_problems_read_well() {
        assert!(OFFICE_SCRIPT.is_ascii());
        assert_eq!(office_problems("\u{feff}Word\t密码不正确。\nWPS\t-\n"), Some("Word：密码不正确。；WPS 没有生成 PDF".into()));
        assert_eq!(office_problems("WPS\tkaizhi:open"), Some("WPS 打不开这份文档".into()));
        assert_eq!(office_problems("  \n"), None);
    }

    #[test]
    fn failed_batch_leaves_no_temp_files() {
        let root = folder();
        let bad = root.join("坏的.docx");
        fs::write(&bad, "not a word file").unwrap();
        let converted = root.join("converted");
        let error = prepare(&[bad.to_string_lossy().into_owned()], &converted).err().unwrap();
        assert!(error.contains("坏的.docx"), "{error}");
        assert_eq!(fs::read_dir(&converted).map(|entries| entries.count()).unwrap_or(0), 0);
        // 不是 Word 的路径不归这里管
        assert!(prepare(&[root.join("a.pdf").to_string_lossy().into_owned()], &converted).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cached_pdf_is_used_while_the_source_is_unchanged_or_gone() {
        let root = folder();
        let converted = root.join("converted");
        fs::create_dir_all(&converted).unwrap();
        let source = root.join("课程报告.docx");
        fs::write(&source, b"PK\x03\x04 word").unwrap();
        let doc = word_doc("doc-1", &source);
        fs::write(converted.join("doc-1.pdf"), b"%PDF-1.7").unwrap();
        fs::write(converted.join("doc-1.src"), stamp(&source).unwrap()).unwrap();
        assert_eq!(ensure(&doc, &converted).unwrap(), converted.join("doc-1.pdf"));
        fs::remove_file(&source).unwrap();
        assert_eq!(ensure(&doc, &converted).unwrap(), converted.join("doc-1.pdf"));
        // 没有缓存、原文件也不在：说明原因
        assert!(ensure(&word_doc("doc-2", &source), &converted).unwrap_err().contains("找不到"));
        forget(&converted, "doc-1");
        assert!(!converted.join("doc-1.pdf").exists() && !converted.join("doc-1.src").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_cleanup_keeps_only_library_documents() {
        let root = folder();
        for name in ["tmp-1.pdf", "tmp-2.pids", "keep.pdf", "keep.src", "gone.pdf", "gone.src", "word-to-pdf.ps1"] { fs::write(root.join(name), b"x").unwrap(); }
        fs::create_dir_all(root.join("tmp-3.lo")).unwrap();
        fs::create_dir_all(root.join("libreoffice-profile")).unwrap();
        clean(&root, Some(&["keep".to_string()]));
        let mut left: Vec<String> = fs::read_dir(&root).unwrap().flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, ["keep.pdf", "keep.src", "libreoffice-profile", "word-to-pdf.ps1"]);
        fs::remove_dir_all(root).unwrap();
    }
}
