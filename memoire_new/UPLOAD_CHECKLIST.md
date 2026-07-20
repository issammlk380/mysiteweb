# OVERLEAF UPLOAD CHECKLIST

## ✓ PRE-UPLOAD VERIFICATION

All files physically verified and ready for upload:

### Root Level Files (MUST be at project root)
- [x] `main.tex` - Main document
- [x] `references.bib` - Bibliography with 35+ citations
- [x] `logo_ibn_tofail.png` - University logo
- [x] `logo_sews.png` - SEWS company logo

### Chapters Directory (MUST be in subdirectory named "chapters")
- [x] `00_cover.tex` - Cover page
- [x] `01_dedication.tex` - Dedication
- [x] `02_acknowledgements.tex` - Acknowledgements
- [x] `03_abstract_fr.tex` - French abstract
- [x] `04_abstract_en.tex` - English abstract
- [x] `05_acronyms.tex` - List of acronyms
- [x] `06_introduction.tex` - Introduction
- [x] `07_state_of_art.tex` - State of the art
- [x] `08_company_context.tex` - Company context
- [x] `09_requirements_analysis.tex` - Requirements
- [x] `10_system_design.tex` - System design
- [x] `11_hardware_architecture.tex` - Hardware architecture
- [x] `12_software_architecture.tex` - Software architecture
- [x] `13_database_design.tex` - Database design
- [x] `14_communication_architecture.tex` - Communication architecture
- [x] `15_system_implementation.tex` - System implementation
- [x] `16_backend_implementation.tex` - Backend implementation
- [x] `17_frontend_implementation.tex` - Frontend implementation
- [x] `18_esp32_implementation.tex` - ESP32 implementation
- [x] `19_experimental_results.tex` - Experimental results
- [x] `20_conclusion.tex` - Conclusion
- [x] `21_appendices.tex` - Appendices

**TOTAL: 22 chapter files ✓**

---

## STEP-BY-STEP UPLOAD GUIDE

### Step 1: Create New Overleaf Project
1. Go to https://www.overleaf.com
2. Click "New Project" → "Blank Project"
3. Name it: "Memoire_Andon_IIoT_2025"

### Step 2: Upload Root Files
Upload these 4 files to the ROOT of your Overleaf project:
- `main.tex`
- `references.bib`
- `logo_ibn_tofail.png`
- `logo_sews.png`

### Step 3: Create Chapters Directory
1. In Overleaf, click "New Folder"
2. Name it exactly: `chapters` (lowercase, no spaces)

### Step 4: Upload All Chapter Files
Upload all 22 `.tex` files from your local `chapters/` folder into the Overleaf `chapters/` folder

**IMPORTANT:** Maintain the exact filenames (00_cover.tex through 21_appendices.tex)

### Step 5: Configure Compiler
1. Click "Menu" (top left in Overleaf)
2. Set "Compiler" to: **pdfLaTeX**
3. Set "TeX Live version" to: **2023** or **2024**
4. Set "Main document" to: **main.tex**
5. Click "Recompile" button

### Step 6: Wait for Compilation
- First compilation takes 30-60 seconds
- Overleaf will run pdfLaTeX → Biber → pdfLaTeX → pdfLaTeX automatically
- Watch the compilation log for any errors

### Step 7: Verify PDF Output
Check that your PDF has:
- [ ] Cover page with both logos
- [ ] Table of contents (all 20+ chapters listed)
- [ ] List of figures
- [ ] List of tables
- [ ] All chapters in correct order
- [ ] Bibliography at the end
- [ ] Appendices after bibliography
- [ ] Page numbers: roman (i, ii, iii...) then arabic (1, 2, 3...)
- [ ] Total pages: 100-110 pages

---

## EXPECTED COMPILATION OUTPUT

```
✓ Compiling... (pass 1/4)
✓ Running Biber...
✓ Compiling... (pass 2/4)
✓ Compiling... (pass 3/4)
✓ Success! PDF generated
```

**Compilation Time:** ~30-60 seconds  
**Output:** main.pdf (100-110 pages)

---

## TROUBLESHOOTING

### Error: "File chapters/XX.tex not found"
→ **Fix:** Ensure `chapters/` folder exists in Overleaf and all .tex files are inside it

### Error: "! LaTeX Error: File 'logo_sews.png' not found"
→ **Fix:** Upload both PNG logos to the ROOT level (not in chapters/ folder)

### Error: "Undefined control sequence"
→ **Fix:** This usually means a special character wasn't escaped. Check the compilation log for the line number

### Warning: "Citation 'xxx' undefined"
→ **Fix:** Normal on first compile. Click "Recompile from scratch" to run full sequence

### PDF has wrong page count
→ **Too long:** Remove some code listings or consolidate sections
→ **Too short:** Expand experimental results or appendices

---

## FILE STRUCTURE DIAGRAM

Your Overleaf project should look like this:

```
📁 Memoire_Andon_IIoT_2025/
├── 📄 main.tex                  ← Root level
├── 📄 references.bib            ← Root level
├── 🖼️ logo_ibn_tofail.png      ← Root level
├── 🖼️ logo_sews.png            ← Root level
└── 📁 chapters/                 ← Subdirectory
    ├── 📄 00_cover.tex
    ├── 📄 01_dedication.tex
    ├── 📄 02_acknowledgements.tex
    ├── 📄 03_abstract_fr.tex
    ├── 📄 04_abstract_en.tex
    ├── 📄 05_acronyms.tex
    ├── 📄 06_introduction.tex
    ├── 📄 07_state_of_art.tex
    ├── 📄 08_company_context.tex
    ├── 📄 09_requirements_analysis.tex
    ├── 📄 10_system_design.tex
    ├── 📄 11_hardware_architecture.tex
    ├── 📄 12_software_architecture.tex
    ├── 📄 13_database_design.tex
    ├── 📄 14_communication_architecture.tex
    ├── 📄 15_system_implementation.tex
    ├── 📄 16_backend_implementation.tex
    ├── 📄 17_frontend_implementation.tex
    ├── 📄 18_esp32_implementation.tex
    ├── 📄 19_experimental_results.tex
    ├── 📄 20_conclusion.tex
    └── 📄 21_appendices.tex
```

---

## POST-COMPILATION CHECKLIST

After successful compilation:

- [ ] Download PDF from Overleaf
- [ ] Open PDF and verify all sections present
- [ ] Check page count is 100-110 pages
- [ ] Verify all figures/tables are numbered correctly
- [ ] Check bibliography has all citations
- [ ] Review for any formatting issues
- [ ] Proofread French text for typos
- [ ] Ensure company/university information is correct
- [ ] Verify contact information is accurate

---

## FINAL NOTES

✓ All files have been physically created and verified  
✓ Content is 100% original (no reuse from old report)  
✓ Based on real implementation with actual measured data  
✓ Includes complete source code in appendices  
✓ Bibliography has 35+ academic and technical references  
✓ Ready for professional submission

**Estimated Upload Time:** 5-10 minutes  
**Estimated First Compilation:** 30-60 seconds  
**Target:** 100-105 pages (NEVER exceed 110)  

---

Good luck with your thesis defense! 🎓
