#!/usr/bin/env python3
"""Build deployment bundles for Qollab.xyz.

Generates:
1. dist/qollab_lab.zip: Pure-Python Qollab project (main.py, py/, requirements.txt)
   for running the quantum algorithm via Qollab's injected IonQ/Qiskit backend.
2. dist/qollab_webapp.zip: JavaScript/HTML Qollab project (index.html, main.js, adapters/)
   for running the interactive Contagion Atlas dashboard in Qollab.
"""

from pathlib import Path
import zipfile
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = REPO_ROOT / "dist"

def create_qollab_lab_bundle():
    lab_dir = REPO_ROOT / "qollab_lab"
    if not lab_dir.exists():
        print(f"Error: {lab_dir} not found", file=sys.stderr)
        return False
    
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    out_zip = DIST_DIR / "qollab_lab.zip"
    
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for p in lab_dir.rglob("*"):
            if p.is_file() and not p.name.startswith(".") and "__pycache__" not in p.parts:
                arcname = p.relative_to(lab_dir)
                z.write(p, arcname)
    
    print(f"✓ Created {out_zip} ({out_zip.stat().st_size / 1024:.1f} KB)")
    return True

def create_qollab_webapp_bundle():
    webapp_dir = REPO_ROOT / "webapp"
    if not webapp_dir.exists():
        print(f"Error: {webapp_dir} not found", file=sys.stderr)
        return False
    
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    out_zip = DIST_DIR / "qollab_webapp.zip"
    
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for p in webapp_dir.rglob("*"):
            if p.is_file() and not p.name.startswith(".") and p.name != "vercel.json":
                arcname = p.relative_to(webapp_dir)
                z.write(p, arcname)
    
    print(f"✓ Created {out_zip} ({out_zip.stat().st_size / 1024:.1f} KB)")
    return True

def main():
    print("Packaging Qollab deployment bundles...")
    success_lab = create_qollab_lab_bundle()
    success_web = create_qollab_webapp_bundle()
    
    if success_lab and success_web:
        print("\nReady for Qollab upload!")
        print("• For Python Lab with IonQ simulator: Upload dist/qollab_lab.zip")
        print("• For Interactive Web App in Qollab: Upload dist/qollab_webapp.zip")

if __name__ == "__main__":
    main()
