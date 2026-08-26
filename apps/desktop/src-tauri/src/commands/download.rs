use crate::models::CommandResult;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

fn downloads_directory() -> CommandResult<PathBuf> {
    let home = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"));
    home.map(|value| PathBuf::from(value).join("Downloads"))
        .ok_or_else(|| "无法确定用户目录，不能保存 PDF。".to_string())
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
    Err("Downloads 文件夹中同名文件过多，无法选择保存文件名。".to_string())
}

#[tauri::command]
pub fn save_pdf_file(filename: String, data: Vec<u8>) -> CommandResult<String> {
    let directory = downloads_directory()?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建 Downloads 文件夹：{error}"))?;
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
