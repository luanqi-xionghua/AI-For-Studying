mod credentials;
mod db;
mod files;
mod http_stream;
mod native_bridge;
mod updater;
mod word;

use db::{Document,DocumentPatch,Library,Result};
use std::{path::{Path,PathBuf},sync::{Arc,Mutex}};
use tauri::{ipc::{Channel,Response},Manager,State};

struct AppState {
    library: Arc<Mutex<Library>>,
    credentials: Arc<Mutex<credentials::Credentials>>,
    bridge: Arc<native_bridge::NativeBridge>,
    http: Arc<http_stream::HttpBridge>,
    host: PathBuf,
    /// Word 文档转好的 PDF：`<应用数据>/converted/<文档 id>.pdf`。
    converted: PathBuf,
}

fn main_window(window: &tauri::Window) -> Result<()> {
    if window.label() != "main" { return Err("只有主阅读窗口能够使用此功能".into()); }
    Ok(())
}

async fn library_operation<T: Send + 'static>(
    library: Arc<Mutex<Library>>,
    operation: impl FnOnce(&mut Library) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = library.lock().map_err(|_| "文档库不可用")?;
        operation(&mut guard)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_documents(window: tauri::Window, state: State<'_,AppState>, query: Option<String>) -> Result<Vec<Document>> {
    main_window(&window)?;
    library_operation(state.library.clone(),move |library| library.list(query.as_deref())).await
}

#[tauri::command]
async fn import_documents(window: tauri::Window, state: State<'_,AppState>, paths: Vec<String>) -> Result<Vec<Document>> {
    main_window(&window)?;
    let converted = state.converted.clone();
    // 先做不花时间的检查（文件在不在、类型、大小、文件头）：批里有坏文件，不用等 Word 都转完才报出来。
    { let paths = paths.clone(); tauri::async_runtime::spawn_blocking(move || db::validate(paths)).await.map_err(|e| e.to_string())??; }
    // Word 文档先转成 PDF：要几秒到几十秒，转的时候不占着文档库的锁；任何一份转不了，整批都不导入。
    let prepared = {
        let (paths,converted) = (paths.clone(),converted.clone());
        tauri::async_runtime::spawn_blocking(move || word::prepare(&paths,&converted)).await.map_err(|e| e.to_string())??
    };
    match library_operation(state.library.clone(),move |library| library.import(paths)).await {
        Ok(documents) => { word::commit(prepared,&documents,&converted); Ok(documents) }
        Err(error) => { word::discard(&prepared); Err(error) }
    }
}

#[tauri::command]
async fn read_document(window: tauri::Window, state: State<'_,AppState>, id: String) -> Result<Response> {
    main_window(&window)?;
    let doc = library_operation(state.library.clone(),move |library| library.get(&id)).await?;
    let converted = state.converted.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Word 文档读的是转好的 PDF（原文件改过就先重新转）。
        let (path,limit) = match doc.kind.as_str() {
            "pdf" => (PathBuf::from(&doc.path),256 * 1024 * 1024),
            "word" => (word::ensure(&doc,&converted)?,256 * 1024 * 1024),
            _ => (PathBuf::from(&doc.path),16 * 1024 * 1024),
        };
        files::read_bounded(&path,limit).map(Response::new)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_document(window: tauri::Window, state: State<'_,AppState>, id: String, patch: DocumentPatch) -> Result<Document> {
    main_window(&window)?;
    library_operation(state.library.clone(),move |library| library.update(&id,patch)).await
}

#[tauri::command]
async fn remove_document(window: tauri::Window, state: State<'_,AppState>, id: String) -> Result<()> {
    main_window(&window)?;
    let removed = id.clone();
    library_operation(state.library.clone(),move |library| library.remove(&id)).await?;
    // Word 文档转好的 PDF 一起删掉（原文件不动）。
    word::forget(&state.converted,&removed);
    Ok(())
}

#[tauri::command]
async fn read_asset(window: tauri::Window, state: State<'_,AppState>, id: String, relative_path: String) -> Result<Response> {
    main_window(&window)?;
    let doc = library_operation(state.library.clone(),move |library| library.get(&id)).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = files::resolve_asset(Path::new(&doc.path),&relative_path)?;
        files::read_bounded(&path,16 * 1024 * 1024).map(Response::new)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn index_document(window: tauri::Window, state: State<'_,AppState>, id: String, text: String) -> Result<()> {
    main_window(&window)?;
    library_operation(state.library.clone(),move |library| library.index(&id,&text)).await
}

#[tauri::command]
async fn get_setting(window: tauri::Window, state: State<'_,AppState>, key: String) -> Result<Option<String>> {
    main_window(&window)?;
    library_operation(state.library.clone(),move |library| library.get_setting(&key)).await
}

#[tauri::command]
async fn set_setting(window: tauri::Window, state: State<'_,AppState>, key: String, value: String) -> Result<()> {
    main_window(&window)?;
    library_operation(state.library.clone(),move |library| library.set_setting(&key,&value)).await
}

#[tauri::command]
async fn get_credential(window: tauri::Window, state: State<'_,AppState>, provider: String) -> Result<Option<String>> {
    main_window(&window)?;
    let credentials = state.credentials.clone();
    tauri::async_runtime::spawn_blocking(move || credentials.lock().map_err(|_| "凭据存储不可用")?.get(&provider)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_credential(window: tauri::Window, state: State<'_,AppState>, provider: String, key: String) -> Result<()> {
    main_window(&window)?;
    let credentials = state.credentials.clone();
    tauri::async_runtime::spawn_blocking(move || credentials.lock().map_err(|_| "凭据存储不可用")?.set(&provider,&key)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn native_connect(window: tauri::Window, state: State<'_,AppState>, channel: Channel<serde_json::Value>) -> Result<String> {
    main_window(&window)?;
    let bridge = state.bridge.clone(); let host = state.host.clone();
    tauri::async_runtime::spawn_blocking(move || bridge.connect(&host,channel)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn native_send(window: tauri::Window, state: State<'_,AppState>, session_id: String, message: serde_json::Value) -> Result<()> {
    main_window(&window)?;
    let bridge = state.bridge.clone();
    tauri::async_runtime::spawn_blocking(move || bridge.send(&session_id,message)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn native_disconnect(window: tauri::Window, state: State<'_,AppState>, session_id: String) -> Result<()> {
    main_window(&window)?;
    let bridge = state.bridge.clone();
    tauri::async_runtime::spawn_blocking(move || bridge.disconnect(&session_id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn http_start(window: tauri::Window,state: State<'_,AppState>,id: String,url: String,method: String,headers: Vec<(String,String)>,body: Option<String>,channel: Channel<http_stream::HttpEvent>) -> Result<()> {
    main_window(&window)?;
    state.http.start(id,url,method,headers,body,channel)
}

#[tauri::command]
async fn http_cancel(window: tauri::Window,state: State<'_,AppState>,id: String) -> Result<()> {
    main_window(&window)?;
    state.http.cancel(&id).await
}

pub fn run() {
    // 0.10.1 → 0.10.2 改名过渡：以旧名 开智.exe 启动的新程序转交给 OpenIntelligence.exe 后退出。
    #[cfg(windows)] if updater::migrate_legacy() { return; }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 免安装版上次自动更新换下的旧文件，启动后再删。
            #[cfg(windows)] std::thread::spawn(updater::remove_leftovers);
            let data_dir = app.path().app_data_dir()?;
            let library = Library::open(&data_dir.join("library.sqlite3")).map_err(std::io::Error::other)?;
            // Word 转换缓存：清掉上次没转完的临时文件和已移除文档的缓存（文件夹很小，启动时同步做完，免得和导入抢）。
            let converted = data_dir.join("converted");
            word::clean(&converted,library.word_ids().ok().as_deref());
            let resource_dir = app.path().resource_dir()?;
            let bundled_host = resource_dir.join("native-host").join("PdfCopilotHost.exe");
            let host = if bundled_host.is_file() { bundled_host } else {
                // Development builds use the same fixed copied resource, never a caller-provided executable.
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("PdfCopilotHost.exe")
            };
            app.manage(AppState {
                library: Arc::new(Mutex::new(library)),
                credentials: Arc::new(Mutex::new(credentials::Credentials::new(data_dir.join("credentials")))),
                bridge: Arc::new(native_bridge::NativeBridge::default()),host,
                http: Arc::new(http_stream::HttpBridge::new().map_err(std::io::Error::other)?),
                converted,
            });
            Ok(())
        })
        .on_window_event(|window,event| {
            if window.label() == "main" && matches!(event,tauri::WindowEvent::Destroyed) {
                window.state::<AppState>().bridge.disconnect_all();
                window.state::<AppState>().http.cancel_all();
            }
        })
        .invoke_handler(tauri::generate_handler![list_documents,import_documents,read_document,update_document,remove_document,read_asset,index_document,get_setting,set_setting,get_credential,set_credential,native_connect,native_send,native_disconnect,http_start,http_cancel,
            updater::update_status,updater::update_check,updater::update_download,updater::update_cancel,updater::update_install,updater::update_open_page])
        .run(tauri::generate_context!())
        .expect("开智启动失败");
}
