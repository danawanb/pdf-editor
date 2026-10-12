mod pdf_ops;

use std::path::{Path, PathBuf};

use pdf_ops::{PageRange, PdfError, Pick};
use tauri::ipc::{InvokeBody, Request, Response};

/// Run blocking PDF work off the main thread so the UI stays responsive.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, PdfError> + Send + 'static,
) -> Result<T, PdfError> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| PdfError::Save(e.to_string()))?
}

#[tauri::command]
async fn page_count(path: String) -> Result<u32, PdfError> {
    blocking(move || Ok(pdf_ops::page_count(&pdf_ops::load(path)?))).await
}

#[tauri::command]
async fn merge_pdfs(inputs: Vec<String>, output: String) -> Result<(), PdfError> {
    blocking(move || {
        let inputs: Vec<PathBuf> = inputs.into_iter().map(PathBuf::from).collect();
        pdf_ops::merge(&inputs, Path::new(&output))
    })
    .await
}

#[tauri::command]
async fn split_pdf(
    input: String,
    ranges: Vec<PageRange>,
    out_dir: String,
) -> Result<Vec<String>, PdfError> {
    blocking(move || {
        let input = PathBuf::from(input);
        let base = input
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "split".into());
        let files = pdf_ops::split(&input, &ranges, Path::new(&out_dir), &base)?;
        Ok(files.into_iter().map(|p| p.display().to_string()).collect())
    })
    .await
}

/// Rebuild `input` with the given page order/rotations and return the bytes;
/// the frontend then draws annotations on top before writing the file.
#[tauri::command]
async fn apply_page_ops(input: String, picks: Vec<Pick>) -> Result<Response, PdfError> {
    blocking(move || {
        let doc = pdf_ops::load(input)?;
        let out = pdf_ops::assemble(vec![doc], &picks)?;
        Ok(Response::new(pdf_ops::to_bytes(out)?))
    })
    .await
}

#[tauri::command]
async fn read_file(path: String) -> Result<Response, PdfError> {
    blocking(move || Ok(Response::new(std::fs::read(path)?))).await
}

/// Write raw bytes from the frontend. The body is the file content; the
/// target path travels URI-encoded in the `path` header.
#[tauri::command]
async fn write_file(request: Request<'_>) -> Result<(), PdfError> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err(PdfError::Save("request body must be raw bytes".into()));
    };
    let path = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned())
        .ok_or_else(|| PdfError::Save("missing path header".into()))?;
    let data = data.clone();
    blocking(move || Ok(std::fs::write(path, data)?)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            page_count,
            merge_pdfs,
            split_pdf,
            apply_page_ops,
            read_file,
            write_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
