import React, { useState } from "react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import Tesseract from "tesseract.js";

// Helper to parse restaurant and date from OCR text
// function parseBillText(text: string): { restaurant: string; date: string } {
//   let restaurant = "UnknownRestaurant";
//   let date = "UnknownDate";

//   const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

//   // First non-empty line = restaurant
//   if (lines.length > 0) {
//     restaurant = lines[0].replace(/[^a-zA-Z0-9]/g, "_");
//   }

//   // Find line with 2025
//   const dateLine = lines.find((l) => l.includes("2025"));
//   if (dateLine) {
//     const idx = dateLine.indexOf("2025");
//     date = dateLine.substring(0, idx + 4).trim().replace(/[^0-9A-Za-z]/g, "-");
//   }

//   return { restaurant, date };
// }

function parseBillText(text: string): { restaurant: string; date: string } {
  let restaurant = "UnknownRestaurant";
  let date = "UnknownDate";

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // First non-empty line = restaurant
  if (lines.length > 0) {
    restaurant = lines[0].replace(/[^a-zA-Z0-9]/g, "_");
  }

  // Find line with 2025 or short /25 format
  const dateLine = lines.find(
    (l) => l.includes("2025") || /\b\d{1,2}\/\d{1,2}\/25\b/.test(l)
  );

  if (dateLine) {
    let extracted = dateLine;

    if (dateLine.includes("2025")) {
      const idx = dateLine.indexOf("2025");
      extracted = dateLine.substring(0, idx + 4);
    } else {
      const match = dateLine.match(/\d{1,2}\/\d{1,2}\/25/);
      if (match) extracted = match[0];
    }

    date = extracted.trim().replace(/[^0-9A-Za-z]/g, "-");
  }

  return { restaurant, date };
}


export default function ImageToPdfConverter(): JSX.Element {
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [generated, setGenerated] = useState<Array<{ name: string; url: string }>>([]);
  const [dragOver, setDragOver] = useState(false);

  function handleFilesInput(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list) return;
    setGenerated([]);
    setFiles(Array.from(list));
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === "image/jpeg" || f.type === "image/png"
    );
    if (droppedFiles.length) {
      setGenerated([]);
      setFiles(droppedFiles);
    }
  }

  async function fileToArrayBuffer(file: File) {
    return await file.arrayBuffer();
  }

  function loadImageDimensions(blobUrl: string) {
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = (err) => reject(err);
      img.src = blobUrl;
    });
  }

  async function convertAllToPdf() {
    if (!files.length) return;
    setProcessing(true);
    setGenerated([]);

    const outputs: Array<{ name: string; url: string }> = [];

    for (const file of files) {
      try {
        const arrayBuffer = await fileToArrayBuffer(file);

        const pdfDoc = await PDFDocument.create();
        const ext = file.name.split(".").pop()?.toLowerCase();

        const blob = new Blob([arrayBuffer], { type: file.type });
        const blobUrl = URL.createObjectURL(blob);
        const dims = await loadImageDimensions(blobUrl);
        URL.revokeObjectURL(blobUrl);

        let embeddedImage;
        if (ext === "jpg" || ext === "jpeg") {
          embeddedImage = await pdfDoc.embedJpg(arrayBuffer);
        } else {
          embeddedImage = await pdfDoc.embedPng(arrayBuffer);
        }

        const page = pdfDoc.addPage([dims.width, dims.height]);
        page.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: dims.width,
          height: dims.height,
        });

        const pdfBytes = await pdfDoc.save();
        const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
        const url = URL.createObjectURL(pdfBlob);

        // Run OCR to extract text
        const { data: { text } } = await Tesseract.recognize(file, "eng");
        const { restaurant, date } = parseBillText(text);

        // Build smart file name
        const safeName = `${date}_${restaurant}.pdf`;

        outputs.push({ name: safeName, url });
      } catch (err) {
        console.error("Failed to convert", file.name, err);
      }
    }

    setGenerated(outputs);
    setProcessing(false);
  }

  async function downloadFile(url: string, filename: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadAllAsZip() {
    if (!generated.length) return;
    const zip = new JSZip();

    for (const item of generated) {
      const resp = await fetch(item.url);
      const blob = await resp.blob();
      zip.file(item.name, blob);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    downloadFile(url, `images-pdfs.zip`);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-3">Image → PDF Converter</h1>

      <p className="mb-2">Select or drag & drop JPEG/PNG bills to convert and rename by restaurant + date.</p>

      <input
        type="file"
        accept="image/jpeg,image/png"
        multiple
        onChange={handleFilesInput}
        className="mb-4"
      />

      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center mb-4 transition ${
          dragOver ? "border-blue-500 bg-blue-50" : "border-gray-400"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {dragOver ? "Drop your images here" : "Or drag & drop images here"}
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={convertAllToPdf}
          disabled={!files.length || processing}
          className="px-4 py-2 rounded shadow bg-blue-600 text-white disabled:opacity-60"
        >
          {processing ? "Converting with OCR..." : "Convert to PDF"}
        </button>

        <button
          onClick={() => {
            setFiles([]);
            setGenerated([]);
          }}
          className="px-4 py-2 rounded shadow bg-gray-200"
        >
          Reset
        </button>

        <button
          onClick={downloadAllAsZip}
          disabled={!generated.length}
          className="px-4 py-2 rounded shadow bg-green-600 text-white disabled:opacity-60"
        >
          Download All (ZIP)
        </button>
      </div>

      {files.length > 0 && (
        <div className="mb-4">
          <h2 className="font-medium">Selected images</h2>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {files.map((f, i) => (
              <div key={i} className="border p-2 text-sm">
                <div className="truncate">{f.name}</div>
                <div className="text-xs text-gray-600">{Math.round(f.size / 1024)} KB</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {generated.length > 0 && (
        <div>
          <h2 className="font-medium mb-2">Generated PDFs</h2>
          <ul className="space-y-2">
            {generated.map((g, idx) => (
              <li key={idx} className="flex items-center gap-3">
                <span className="truncate w-64">{g.name}</span>
                <button
                  onClick={() => downloadFile(g.url, g.name)}
                  className="px-3 py-1 rounded bg-blue-500 text-white"
                >
                  Download
                </button>
                <a href={g.url} target="_blank" rel="noreferrer" className="text-sm underline">
                  Open
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}