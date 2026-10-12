//! Page-level PDF operations built on lopdf: merge, split, reorder, rotate,
//! delete and duplicate. Every operation is expressed as "assemble a new
//! document from a list of page picks", so they all share one code path.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use lopdf::{dictionary, Dictionary, Document, Object, ObjectId};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum PdfError {
    #[error("Could not read PDF \"{path}\": {source}")]
    Load { path: String, source: lopdf::Error },
    #[error("PDF \"{0}\" is password-protected; unlock it first")]
    Encrypted(String),
    #[error("Page {page} does not exist (the document has only {count} pages)")]
    PageOutOfRange { page: u32, count: u32 },
    #[error("No pages selected")]
    Empty,
    #[error("Could not save PDF: {0}")]
    Save(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for PdfError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, PdfError>;

/// One page in the output: page `page` (1-based) of source document `doc`,
/// rotated clockwise by an extra `rotate` degrees (multiple of 90).
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Pick {
    pub doc: usize,
    pub page: u32,
    #[serde(default)]
    pub rotate: i64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct PageRange {
    pub start: u32,
    pub end: u32,
}

pub fn load(path: impl AsRef<Path>) -> Result<Document> {
    let path = path.as_ref();
    let display = path.display().to_string();
    let doc = Document::load(path).map_err(|source| PdfError::Load {
        path: display.clone(),
        source,
    })?;
    // lopdf transparently decrypts files with an empty user password; anything
    // still encrypted after loading needs a password we don't have.
    if doc.is_encrypted() {
        return Err(PdfError::Encrypted(display));
    }
    Ok(doc)
}

pub fn page_count(doc: &Document) -> u32 {
    doc.get_pages().len() as u32
}

const INHERITABLE: [&[u8]; 4] = [b"Resources", b"MediaBox", b"CropBox", b"Rotate"];

/// Copy attributes a page inherits from its ancestor /Pages nodes onto the
/// page itself, so the page stays correct once re-parented.
fn materialize_inherited(doc: &mut Document, page_id: ObjectId) {
    let mut inherited: Vec<(&[u8], Object)> = Vec::new();
    let Ok(page) = doc.get_dictionary(page_id) else { return };
    let mut missing: Vec<&[u8]> = INHERITABLE
        .iter()
        .copied()
        .filter(|k| !page.has(k))
        .collect();
    let mut parent = page.get(b"Parent").and_then(Object::as_reference).ok();
    let mut seen = HashSet::new();
    while let Some(pid) = parent {
        if missing.is_empty() || !seen.insert(pid) {
            break;
        }
        let Ok(node) = doc.get_dictionary(pid) else { break };
        missing.retain(|k| match node.get(k) {
            Ok(v) => {
                inherited.push((k, v.clone()));
                false
            }
            Err(_) => true,
        });
        parent = node.get(b"Parent").and_then(Object::as_reference).ok();
    }
    if let Ok(Object::Dictionary(page)) = doc.get_object_mut(page_id) {
        for (k, v) in inherited {
            page.set(k, v);
        }
    }
}

fn rotation_of(page: &Dictionary) -> i64 {
    match page.get(b"Rotate") {
        Ok(Object::Integer(i)) => *i,
        Ok(Object::Real(r)) => *r as i64,
        _ => 0,
    }
}

/// Build a new document containing exactly `picks`, in order.
pub fn assemble(docs: Vec<Document>, picks: &[Pick]) -> Result<Document> {
    if picks.is_empty() {
        return Err(PdfError::Empty);
    }

    let mut out = Document::with_version("1.7");
    let mut page_maps: Vec<BTreeMap<u32, ObjectId>> = Vec::with_capacity(docs.len());
    let mut next_id = 1;

    for mut doc in docs {
        doc.renumber_objects_with(next_id);
        next_id = doc.max_id + 1;
        let pages = doc.get_pages();
        for &id in pages.values() {
            materialize_inherited(&mut doc, id);
        }
        page_maps.push(pages);
        out.objects.append(&mut doc.objects);
    }
    out.max_id = next_id;

    let pages_id = out.new_object_id();
    let mut used = HashSet::new();
    let mut kids = Vec::with_capacity(picks.len());

    for pick in picks {
        let map = &page_maps[pick.doc];
        let src = *map.get(&pick.page).ok_or(PdfError::PageOutOfRange {
            page: pick.page,
            count: map.len() as u32,
        })?;
        let mut dict = out
            .get_dictionary(src)
            .map_err(|e| PdfError::Save(e.to_string()))?
            .clone();
        dict.set("Parent", pages_id);
        let rotation = (rotation_of(&dict) + pick.rotate).rem_euclid(360);
        if rotation == 0 {
            dict.remove(b"Rotate");
        } else {
            dict.set("Rotate", rotation);
        }
        // Reuse the original object the first time so internal links keep
        // working; duplicates get their own copy (sharing content streams).
        let id = if used.insert(src) {
            out.objects.insert(src, Object::Dictionary(dict));
            src
        } else {
            out.add_object(dict)
        };
        kids.push(Object::Reference(id));
    }

    let count = kids.len() as i64;
    out.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => count,
        }),
    );
    let catalog_id = out.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    out.trailer.set("Root", catalog_id);

    out.prune_objects();
    out.renumber_objects();
    out.compress();
    Ok(out)
}

fn save(mut doc: Document, path: &Path) -> Result<()> {
    doc.save(path).map_err(|e| PdfError::Save(e.to_string()))?;
    Ok(())
}

pub fn to_bytes(mut doc: Document) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    doc.save_to(&mut buf)
        .map_err(|e| PdfError::Save(e.to_string()))?;
    Ok(buf)
}

pub fn merge(inputs: &[PathBuf], output: &Path) -> Result<()> {
    let docs = inputs.iter().map(load).collect::<Result<Vec<_>>>()?;
    let picks: Vec<Pick> = docs
        .iter()
        .enumerate()
        .flat_map(|(i, d)| (1..=page_count(d)).map(move |p| Pick { doc: i, page: p, rotate: 0 }))
        .collect();
    save(assemble(docs, &picks)?, output)
}

pub fn split(
    input: &Path,
    ranges: &[PageRange],
    out_dir: &Path,
    base_name: &str,
) -> Result<Vec<PathBuf>> {
    let doc = load(input)?;
    let count = page_count(&doc);
    if ranges.is_empty() {
        return Err(PdfError::Empty);
    }
    for r in ranges {
        for page in [r.start, r.end] {
            if page == 0 || page > count {
                return Err(PdfError::PageOutOfRange { page, count });
            }
        }
    }

    let mut written = Vec::with_capacity(ranges.len());
    for r in ranges {
        let (a, b) = if r.start <= r.end { (r.start, r.end) } else { (r.end, r.start) };
        let picks: Vec<Pick> = (a..=b).map(|p| Pick { doc: 0, page: p, rotate: 0 }).collect();
        let name = if a == b {
            format!("{base_name}_page-{a}.pdf")
        } else {
            format!("{base_name}_pages-{a}-{b}.pdf")
        };
        let path = out_dir.join(name);
        save(assemble(vec![doc.clone()], &picks)?, &path)?;
        written.push(path);
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::content::{Content, Operation};
    use lopdf::Stream;

    /// A minimal document with `n` pages; page i draws the text "Page i".
    /// Pages inherit MediaBox and Resources from the /Pages node.
    fn sample(n: u32) -> Document {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        });
        let resources_id = doc.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        let kids: Vec<Object> = (1..=n)
            .map(|i| {
                let content = Content {
                    operations: vec![
                        Operation::new("BT", vec![]),
                        Operation::new("Tf", vec!["F1".into(), 24.into()]),
                        Operation::new("Td", vec![100.into(), 600.into()]),
                        Operation::new("Tj", vec![Object::string_literal(format!("Page {i}"))]),
                        Operation::new("ET", vec![]),
                    ],
                };
                let cid = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
                doc.add_object(dictionary! {
                    "Type" => "Page", "Parent" => pages_id, "Contents" => cid,
                })
                .into()
            })
            .collect();
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages", "Kids" => kids, "Count" => n as i64,
                "Resources" => resources_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        doc
    }

    fn roundtrip(doc: Document) -> Document {
        Document::load_mem(&to_bytes(doc).unwrap()).unwrap()
    }

    fn page_text(doc: &Document, page: u32) -> String {
        doc.extract_text(&[page]).unwrap().trim().to_string()
    }

    fn page_dict(doc: &Document, page: u32) -> &Dictionary {
        doc.get_dictionary(doc.get_pages()[&page]).unwrap()
    }

    #[test]
    fn merge_concatenates_all_pages() {
        let picks: Vec<Pick> = [(0, 1), (0, 2), (1, 1), (1, 2), (1, 3)]
            .map(|(doc, page)| Pick { doc, page, rotate: 0 })
            .to_vec();
        let out = roundtrip(assemble(vec![sample(2), sample(3)], &picks).unwrap());
        assert_eq!(page_count(&out), 5);
        assert_eq!(page_text(&out, 3), "Page 1");
        assert_eq!(page_text(&out, 5), "Page 3");
        // Inherited attributes survive re-parenting.
        assert!(page_dict(&out, 4).has(b"MediaBox"));
        assert!(page_dict(&out, 4).has(b"Resources"));
    }

    #[test]
    fn reorder_rotate_delete_duplicate() {
        let picks = [
            Pick { doc: 0, page: 3, rotate: 90 },
            Pick { doc: 0, page: 1, rotate: 0 },
            Pick { doc: 0, page: 1, rotate: -90 },
        ];
        let out = roundtrip(assemble(vec![sample(4)], &picks).unwrap());
        assert_eq!(page_count(&out), 3);
        assert_eq!(page_text(&out, 1), "Page 3");
        assert_eq!(page_text(&out, 2), "Page 1");
        assert_eq!(page_text(&out, 3), "Page 1");
        assert_eq!(rotation_of(page_dict(&out, 1)), 90);
        assert_eq!(rotation_of(page_dict(&out, 2)), 0);
        assert_eq!(rotation_of(page_dict(&out, 3)), 270);
    }

    #[test]
    fn split_writes_one_file_per_range() {
        let dir = std::env::temp_dir().join(format!("pdf-split-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("in.pdf");
        sample(5).save(&input).unwrap();

        let ranges = [PageRange { start: 1, end: 2 }, PageRange { start: 4, end: 4 }];
        let files = split(&input, &ranges, &dir, "in").unwrap();
        assert_eq!(files.len(), 2);
        assert!(files[0].ends_with("in_pages-1-2.pdf"));
        assert_eq!(page_count(&load(&files[0]).unwrap()), 2);
        let second = load(&files[1]).unwrap();
        assert_eq!(page_count(&second), 1);
        assert_eq!(page_text(&second, 1), "Page 4");

        let err = split(&input, &[PageRange { start: 3, end: 9 }], &dir, "in").unwrap_err();
        assert!(matches!(err, PdfError::PageOutOfRange { page: 9, count: 5 }));
        std::fs::remove_dir_all(&dir).ok();
    }
}
