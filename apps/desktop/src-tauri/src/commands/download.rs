use crate::filesystem::{packaged_portable_dir, regular_windows_path};
use crate::models::CommandResult;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn default_download_directory(app: &AppHandle) -> CommandResult<PathBuf> {
    if let Some(directory) = packaged_portable_dir(app)? {
        return Ok(directory);
    }

    // During `tauri dev`, resources live outside the portable layout. Keeping
    // the resolver usable there makes the settings page testable while the
    // packaged build still resolves to the extracted package root.
    app.path()
        .resource_dir()
        .map(regular_windows_path)
        .map_err(|error| format!("无法确定便携包目录：{error}"))
}

fn sanitize_filename(filename: &str) -> String {
    let mut stem = filename
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    while matches!(stem.chars().last(), Some('.' | ' ')) {
        stem.pop();
    }
    if stem.to_ascii_lowercase().ends_with(".pdf") {
        stem.truncate(stem.len() - 4);
        while matches!(stem.chars().last(), Some('.' | ' ')) {
            stem.pop();
        }
    }
    stem = stem.chars().take(140).collect();

    let reserved_name = stem
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if stem.is_empty()
        || matches!(
            reserved_name.as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
    {
        stem = "paper".to_string();
    }
    format!("{stem}.pdf")
}

fn create_unique_file(directory: &Path, filename: &str) -> CommandResult<(PathBuf, File)> {
    let stem = filename.strip_suffix(".pdf").unwrap_or(filename);
    for index in 0..10_000u32 {
        let candidate_name = if index == 0 {
            filename.to_string()
        } else {
            format!("{stem} ({index}).pdf")
        };
        let candidate = directory.join(candidate_name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法创建 PDF 文件：{error}")),
        }
    }
    Err("目标文件夹中同名文件过多，无法选择保存文件名。".to_string())
}

#[tauri::command]
pub fn get_default_download_directory(app: AppHandle) -> CommandResult<String> {
    Ok(default_download_directory(&app)?
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub fn save_pdf_file(
    app: AppHandle,
    filename: String,
    data: Vec<u8>,
    directory: Option<String>,
) -> CommandResult<String> {
    let directory = match directory.filter(|value| !value.trim().is_empty()) {
        Some(value) => regular_windows_path(PathBuf::from(value.trim())),
        None => default_download_directory(&app)?,
    };
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建 PDF 保存文件夹：{error}"))?;
    let safe_filename = sanitize_filename(&filename);
    let (path, mut file) = create_unique_file(&directory, &safe_filename)?;
    if let Err(error) = file.write_all(&data).and_then(|_| file.flush()) {
        let _ = fs::remove_file(&path);
        return Err(format!("写入 PDF 失败：{error}"));
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::sanitize_filename;

    #[test]
    fn sanitizes_windows_filename_and_extension() {
        assert_eq!(sanitize_filename("A:/paper?.pdf"), "A paper.pdf");
        assert_eq!(sanitize_filename("CON"), "paper.pdf");
        assert_eq!(sanitize_filename("  "), "paper.pdf");
    }
}
