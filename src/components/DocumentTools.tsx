import { useState, useCallback, useRef } from "react";
import { FileText, Image, Upload, FileDown, Sparkles, Loader2, X, Copy, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type ProcessingStatus = "idle" | "uploading" | "processing" | "done" | "error";
type OutputAction = "summarize" | "explain" | "blog" | "keypoints";

interface ProcessedResult {
  text: string;
  fileName: string;
  fileType: string;
  processedAt: string;
}

const AI_ACTIONS: { id: OutputAction; label: string; icon: typeof Sparkles; prompt: string }[] = [
  { id: "summarize", label: "Summarize", icon: Sparkles, prompt: "Summarize the following document content concisely:" },
  { id: "explain", label: "Explain Simply", icon: Sparkles, prompt: "Explain the following document content like I'm a beginner:" },
  { id: "blog", label: "Turn into Article", icon: FileText, prompt: "Rewrite the following content as a well-structured blog article:" },
  { id: "keypoints", label: "Key Points", icon: FileDown, prompt: "Extract only the key points from the following document:" },
];

export function DocumentTools() {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ProcessingStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const extractPdfText = useCallback(async (file: File): Promise<string> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      setProgress(Math.round((i / pdf.numPages) * 80));
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(" ");
      fullText += `\n--- Page ${i} ---\n${pageText}`;
    }

    return fullText.trim();
  }, []);

  const extractImageText = useCallback(async (file: File): Promise<string> => {
    const Tesseract = await import("tesseract.js");
    setProgress(20);

    const result = await Tesseract.recognize(file, "eng", {
      logger: (m: any) => {
        if (m.status === "recognizing text" && m.progress) {
          setProgress(20 + Math.round(m.progress * 60));
        }
      },
    });

    return result.data.text.trim();
  }, []);

  const processFile = useCallback(async (file: File) => {
    const maxSize = 25 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({ title: "File too large", description: "Maximum file size is 25MB.", variant: "destructive" });
      return;
    }

    setStatus("processing");
    setProgress(5);
    setResult(null);
    setAiResult(null);

    try {
      let text = "";
      const type = file.type;

      if (type === "application/pdf") {
        text = await extractPdfText(file);
      } else if (type.startsWith("image/")) {
        text = await extractImageText(file);
      } else if (
        type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        file.name.endsWith(".docx")
      ) {
        // Basic .docx: read as ArrayBuffer, extract text from XML
        text = await extractDocxText(file);
      } else if (type === "text/plain" || file.name.endsWith(".txt")) {
        text = await file.text();
      } else {
        toast({ title: "Unsupported file type", description: "Please upload a PDF, image (PNG/JPG/WEBP), DOCX, or TXT file.", variant: "destructive" });
        setStatus("idle");
        return;
      }

      setProgress(90);

      if (!text || text.length < 5) {
        toast({ title: "No text found", description: "Could not extract readable text from this file.", variant: "destructive" });
        setStatus("error");
        return;
      }

      // Save to history
      if (user) {
        await supabase.from("research_history").insert({
          user_id: user.id,
          query: `[Document] ${file.name}`,
          content: text.slice(0, 50000),
          sources: [] as any,
        });
      }

      setProgress(100);
      setResult({
        text,
        fileName: file.name,
        fileType: type,
        processedAt: new Date().toISOString(),
      });
      setStatus("done");
      toast({ title: "Extraction complete", description: `Extracted ${text.length.toLocaleString()} characters from ${file.name}` });
    } catch (err: any) {
      console.error("Processing error:", err);
      setStatus("error");
      toast({ title: "Processing failed", description: err.message || "An error occurred.", variant: "destructive" });
    }
  }, [extractPdfText, extractImageText, toast, user]);

  const extractDocxText = async (file: File): Promise<string> => {
    // Simple DOCX text extraction using JSZip-like approach
    // DOCX is a ZIP containing XML files
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer]);
    
    // Use the browser's built-in decompression
    const entries: string[] = [];
    try {
      const { default: JSZip } = await import("jszip") as any;
      const zip = await JSZip.loadAsync(blob);
      const docXml = await zip.file("word/document.xml")?.async("string");
      if (docXml) {
        // Strip XML tags to get text
        const text = docXml
          .replace(/<w:p[^>]*>/g, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        return text;
      }
    } catch {
      // Fallback: try reading as text
    }
    
    return file.text();
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [processFile]);

  const handleAiAction = useCallback(async (action: OutputAction) => {
    if (!result?.text) return;
    setAiLoading(true);
    setAiResult(null);

    try {
      const actionConfig = AI_ACTIONS.find(a => a.id === action);
      const prompt = `${actionConfig?.prompt}\n\n${result.text.slice(0, 15000)}`;

      const { data, error } = await supabase.functions.invoke("research-agent", {
        body: { query: prompt, depth: "quick", research_type: "executive" },
      });

      if (error) throw error;
      setAiResult(data?.content || "No response generated.");
    } catch (err: any) {
      toast({ title: "AI processing failed", description: err.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  }, [result, toast]);

  const handleCopy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleReset = useCallback(() => {
    setStatus("idle");
    setProgress(0);
    setResult(null);
    setAiResult(null);
  }, []);

  const conversionOptions = [
    { label: "PDF → Text", icon: FileText, accept: ".pdf", desc: "Extract text from PDF documents" },
    { label: "Image → Text (OCR)", icon: Image, accept: ".png,.jpg,.jpeg,.webp", desc: "Extract text from images" },
    { label: "Word → Text", icon: FileText, accept: ".docx", desc: "Extract text from Word documents" },
    { label: "TXT Upload", icon: FileDown, accept: ".txt", desc: "Upload and analyze text files" },
  ];

  return (
    <div className="max-w-[900px] mx-auto px-4 py-6 md:py-10">
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold font-display text-foreground">Document Tools</h1>
        <p className="text-sm text-muted-foreground mt-1 font-display">
          Upload files to extract text, run OCR, or generate AI-powered summaries.
        </p>
      </div>

      {/* Upload Area */}
      {status === "idle" && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative cursor-pointer rounded-xl border-2 border-dashed p-10 md:p-16 text-center transition-all duration-200 ${
              dragOver
                ? "border-primary bg-primary/5 scale-[1.01]"
                : "border-border hover:border-primary/50 hover:bg-muted/50"
            }`}
          >
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <p className="text-base font-medium font-display text-foreground">
              Drop your file here or <span className="text-primary">browse</span>
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              PDF, Images (PNG, JPG, WEBP), Word (.docx), TXT — Max 25MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Conversion Options Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {conversionOptions.map((opt) => (
              <button
                key={opt.label}
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.accept = opt.accept;
                    fileInputRef.current.click();
                  }
                }}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-card hover:bg-muted/50 hover:border-primary/30 transition-all text-center group"
              >
                <opt.icon className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                <span className="text-xs font-medium font-display text-foreground">{opt.label}</span>
                <span className="text-[10px] text-muted-foreground leading-tight">{opt.desc}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Processing State */}
      {status === "processing" && (
        <Card className="border-primary/20">
          <CardContent className="p-8 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-sm font-medium font-display text-foreground mb-3">Processing your document…</p>
            <div className="w-full max-w-xs mx-auto bg-secondary rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">{progress}% complete</p>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {status === "error" && (
        <Card className="border-destructive/30">
          <CardContent className="p-8 text-center">
            <X className="h-10 w-10 text-destructive mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground mb-3 font-display">Processing failed</p>
            <Button onClick={handleReset} variant="outline" size="sm">Try Again</Button>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {status === "done" && result && (
        <div className="space-y-4">
          {/* File Info + Actions Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl bg-card border border-border">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="h-5 w-5 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium font-display text-foreground truncate">{result.fileName}</p>
                <p className="text-xs text-muted-foreground">{result.text.length.toLocaleString()} characters extracted</p>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button size="sm" variant="outline" onClick={() => handleCopy(result.text)}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="ml-1.5">{copied ? "Copied" : "Copy"}</span>
              </Button>
              <Button size="sm" variant="outline" onClick={handleReset}>
                New File
              </Button>
            </div>
          </div>

          {/* Extracted Text Preview */}
          <Tabs defaultValue="extracted" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="extracted" className="flex-1">Extracted Text</TabsTrigger>
              <TabsTrigger value="ai" className="flex-1">AI Analysis</TabsTrigger>
            </TabsList>

            <TabsContent value="extracted">
              <Card>
                <CardContent className="p-4">
                  <pre className="text-xs text-foreground whitespace-pre-wrap max-h-[400px] overflow-y-auto font-mono leading-relaxed">
                    {result.text}
                  </pre>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ai">
              {/* AI Action Buttons */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                {AI_ACTIONS.map((action) => (
                  <Button
                    key={action.id}
                    variant="outline"
                    size="sm"
                    onClick={() => handleAiAction(action.id)}
                    disabled={aiLoading}
                    className="text-xs"
                  >
                    {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <action.icon className="h-3.5 w-3.5 mr-1.5" />}
                    {action.label}
                  </Button>
                ))}
              </div>

              <Card>
                <CardContent className="p-4">
                  {aiLoading && (
                    <div className="flex items-center gap-3 py-8 justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <span className="text-sm text-muted-foreground font-display">Analyzing document…</span>
                    </div>
                  )}
                  {!aiLoading && aiResult && (
                    <div className="space-y-3">
                      <div className="flex justify-end">
                        <Button size="sm" variant="ghost" onClick={() => handleCopy(aiResult)}>
                          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                      <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed prose prose-sm max-w-none">
                        {aiResult}
                      </div>
                    </div>
                  )}
                  {!aiLoading && !aiResult && (
                    <p className="text-sm text-muted-foreground text-center py-8 font-display">
                      Choose an AI action above to analyze the extracted text.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
