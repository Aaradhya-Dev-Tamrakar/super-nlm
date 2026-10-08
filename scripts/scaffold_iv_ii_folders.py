#!/usr/bin/env python3
"""
scaffold_iv_ii_folders.py
Deterministic academic folder scaffolder and syllabus extractor for Year IV Part II (IV-II).
Replicates the proven structure of IV-I while supporting modular, undecided Electives.
"""

import os
import re
import sys
import shutil
from pathlib import Path

BASE_DIR = Path(r"D:\Misc Aaradhya\Electronics (NEW 075-079)\[IV-II]")
SYLLABUS_MD = BASE_DIR / "BEIE_IV_II_Study_Syllabus.md"

def extract_section(content: str, header_regex: str, next_header_regex: str = None) -> str:
    """Extracts a section from markdown between header_regex and next_header_regex."""
    match = re.search(header_regex, content, re.MULTILINE)
    if not match:
        return ""
    start_pos = match.start()
    if next_header_regex:
        next_match = re.search(next_header_regex, content[match.end():], re.MULTILINE)
        if next_match:
            end_pos = match.end() + next_match.start()
            return content[start_pos:end_pos].strip()
    return content[start_pos:].strip()

def main(dry_run: bool = False):
    print(f"=== Starting IV-II Scaffolding ===")
    print(f"Target Directory: {BASE_DIR}")
    print(f"Dry Run: {dry_run}")

    if not BASE_DIR.exists():
        print(f"ERROR: Base directory does not exist: {BASE_DIR}")
        sys.exit(1)

    if not SYLLABUS_MD.exists():
        print(f"ERROR: Syllabus markdown does not exist: {SYLLABUS_MD}")
        sys.exit(1)

    with open(SYLLABUS_MD, "r", encoding="utf-8") as f:
        full_syllabus = f.read()

    # 1. Core Subjects Scaffolding
    core_subjects = [
        {
            "name": "Telecommunication",
            "code": "EX 756 / EX 703",
            "filename": "Telecommunication_BEIE_IV_II_Syllabus.md",
            "regex": r"^## 3\. Telecommunication",
            "next_regex": r"^## 4\. Engineering Professional Practice"
        },
        {
            "name": "Engineering Professional Practice",
            "code": "CE 752",
            "filename": "EPP_BEIE_IV_II_Syllabus.md",
            "regex": r"^## 4\. Engineering Professional Practice",
            "next_regex": r"^## 5\. Energy, Environment and Society"
        },
        {
            "name": "Energy, Environment and Society",
            "code": "EX 758",
            "filename": "EES_BEIE_IV_II_Syllabus.md",
            "regex": r"^## 5\. Energy, Environment and Society",
            "next_regex": r"^## 6\. Information Systems"
        },
        {
            "name": "Information System",
            "code": "CT 751",
            "filename": "Information_Systems_BEIE_IV_II_Syllabus.md",
            "regex": r"^## 6\. Information Systems",
            "next_regex": r"^## 7\. Project-II"
        },
        {
            "name": "Project-II (Part B)",
            "code": "EX 755",
            "filename": "Project_II_BEIE_IV_II_Guidelines.md",
            "regex": r"^## 7\. Project-II",
            "next_regex": r"^## 8\. Elective II"
        }
    ]

    for subj in core_subjects:
        dir_path = BASE_DIR / subj["name"]
        if not dir_path.exists():
            print(f"[CREATE DIR] {dir_path}")
            if not dry_run:
                dir_path.mkdir(parents=True, exist_ok=True)
        else:
            print(f"[EXISTING DIR] {dir_path}")

        extracted = extract_section(full_syllabus, subj["regex"], subj["next_regex"])
        if extracted:
            out_file = dir_path / subj["filename"]
            print(f"  -> Writing syllabus extract: {out_file.name} ({len(extracted)} chars)")
            if not dry_run:
                with open(out_file, "w", encoding="utf-8") as out_f:
                    out_f.write(f"# {subj['name']} ({subj['code']})\n\n{extracted}\n")

    # 2. Centralized Past Qns Hub
    past_qns_dir = BASE_DIR / "Past Qns"
    if not past_qns_dir.exists():
        print(f"[CREATE DIR] {past_qns_dir}")
        if not dry_run:
            past_qns_dir.mkdir(parents=True, exist_ok=True)

    past_qns_index = """# Centralized Past Questions Hub: Year IV Part II (BEI)

This hub consolidates official TU/IOE past examination questions, solution manuals, and model sets for IV-II semester subjects.

## Subject Quick Links
- **Telecommunication (EX 756)**:
  - `4.2bei_telecom_old_questions.pdf` (Pulchowk collection)
  - `4.2bei_telecom_question_bank.pdf`
- **Engineering Professional Practice (CE 752)**:
  - `4.2bei_epp_old_questions.pdf` (Ritik collection)
  - `4.2bei_epp_cases.pdf` (Case studies & legal dispute questions)
- **Energy, Environment and Society (EX 758)**:
  - `4.2bei_ees_old_questions_2069_2079.pdf` (10-year IOE compiled solutions)
- **Information Systems (CT 751)**:
  - Lecture slide past questions and model questions cataloged in subject folder.
- **Electives**:
  - `Elective II` & `Elective III` past question collections cataloged per finalized option.
"""
    if not dry_run:
        with open(past_qns_dir / "Past_Questions_Index.md", "w", encoding="utf-8") as f:
            f.write(past_qns_index)
        print("  -> Created Past Qns Index")

        # Copy existing past papers with standardized names
        src_telecom_q1 = BASE_DIR / "Telecommunication" / "Notes by Sir [PUL]" / "Additional" / "Telecommunication Old Question Collection.pdf"
        src_telecom_q2 = BASE_DIR / "Telecommunication" / "Notes by Sir [PUL]" / "Additional" / "Question Bank.pdf"
        src_epp_q1 = BASE_DIR / "Engineering Professional Practice" / "Recommended by Ritik" / "2" / "old qsn epp.pdf"
        src_epp_q2 = BASE_DIR / "Engineering Professional Practice" / "Notes by PO Sir" / "EPP cases.pdf"
        src_ees_q1 = BASE_DIR / "Energy, Environment and Society" / "By Bikal Adhikari" / "2.Old Questions" / "Old Questions 2069 to 2079.pdf"

        copies = [
            (src_telecom_q1, past_qns_dir / "4.2bei_telecom_old_questions.pdf"),
            (src_telecom_q2, past_qns_dir / "4.2bei_telecom_question_bank.pdf"),
            (src_epp_q1, past_qns_dir / "4.2bei_epp_old_questions.pdf"),
            (src_epp_q2, past_qns_dir / "4.2bei_epp_cases.pdf"),
            (src_ees_q1, past_qns_dir / "4.2bei_ees_old_questions_2069_2079.pdf"),
        ]
        for src, dst in copies:
            if src.exists() and not dst.exists():
                shutil.copy2(src, dst)
                print(f"  -> Copied {src.name} -> {dst.name}")

    # 3. Modular Elective II Options Scaffolding
    el2_dir = BASE_DIR / "Elective II"
    if not el2_dir.exists():
        if not dry_run:
            el2_dir.mkdir(parents=True, exist_ok=True)

    elective_ii_options = [
        {"code": "CT 765 02", "name": "Agile Software Development", "folder": "CT 765 02 - Agile Software Development", "regex": r"^### 8\.1 Agile Software Development", "next_regex": r"^### 8\.2 Networking with IPv6"},
        {"code": "CT 765 03", "name": "Networking with IPv6", "folder": "CT 765 03 - Networking with IPv6", "regex": r"^### 8\.2 Networking with IPv6", "next_regex": r"^### 8\.3 Advanced Computer Architecture"},
        {"code": "CT 765 04", "name": "Advanced Computer Architecture", "folder": "CT 765 04 - Advanced Computer Architecture", "regex": r"^### 8\.3 Advanced Computer Architecture", "next_regex": r"^### 8\.4 Information Systems"},
        {"code": "CT 765 05", "name": "Information Systems", "folder": "CT 765 05 - Information Systems", "regex": r"^### 8\.4 Information Systems", "next_regex": r"^### 8\.5 Big Data Technologies"},
        {"code": "CT 765 07", "name": "Big Data Technologies", "folder": "Big Data Technologies", "regex": r"^### 8\.5 Big Data Technologies", "next_regex": r"^### 8\.6 Optical Fiber Communication System"},
        {"code": "EX 765 01", "name": "Optical Fiber Communication System", "folder": "EX 765 01 - Optical Fiber Communication System", "regex": r"^### 8\.6 Optical Fiber Communication System", "next_regex": r"^### 8\.7 Broadcast Engineering"},
        {"code": "EX 765 03", "name": "Broadcast Engineering", "folder": "EX 765 03 - Broadcast Engineering", "regex": r"^### 8\.7 Broadcast Engineering", "next_regex": r"^### 8\.8 Database Management Systems"},
        {"code": "EX 765 06", "name": "Database Management Systems", "folder": "EX 765 06 - Database Management Systems", "regex": r"^### 8\.8 Database Management Systems", "next_regex": r"^## 9\. Elective III"},
    ]

    el2_catalog_md = "# Elective II Options Catalog (BEI IV-II)\n\n| Code | Title | Status |\n|---|---|---|\n"
    for opt in elective_ii_options:
        opt_path = el2_dir / opt["folder"]
        if not opt_path.exists():
            print(f"[CREATE DIR] {opt_path}")
            if not dry_run:
                opt_path.mkdir(parents=True, exist_ok=True)
        else:
            print(f"[PRESERVE DIR] {opt_path}")

        extracted = extract_section(full_syllabus, opt["regex"], opt["next_regex"])
        if extracted and not dry_run:
            syl_path = opt_path / "Syllabus.md"
            with open(syl_path, "w", encoding="utf-8") as f:
                f.write(f"# {opt['name']} ({opt['code']})\n\n{extracted}\n")

        status = "Active Resources Present (130 files)" if opt["folder"] == "Big Data Technologies" else "Placeholder Scaffolding Ready"
        el2_catalog_md += f"| {opt['code']} | {opt['name']} | {status} |\n"

    if not dry_run:
        with open(el2_dir / "_Elective_II_Options_Catalog.md", "w", encoding="utf-8") as f:
            f.write(el2_catalog_md)
        print("  -> Created Elective II Catalog")

    # 4. Modular Elective III Options Scaffolding
    el3_dir = BASE_DIR / "Elective III"
    if not el3_dir.exists():
        if not dry_run:
            el3_dir.mkdir(parents=True, exist_ok=True)

    elective_iii_options = [
        {"code": "CT 785 03", "name": "Multimedia System", "folder": "Multimedia System", "regex": r"^### 9\.1 Multimedia System", "next_regex": r"^### 9\.2 Enterprise Application Design and Development"},
        {"code": "CT 785 04", "name": "Enterprise Application Design and Development", "folder": "CT 785 04 - Enterprise Application Design and Development", "regex": r"^### 9\.2 Enterprise Application Design and Development", "next_regex": r"^### 9\.3 Geographical Information System"},
        {"code": "CT 785 07", "name": "Geographical Information System", "folder": "CT 785 07 - Geographical Information System", "regex": r"^### 9\.3 Geographical Information System", "next_regex": r"^### 9\.4 Power Electronics"},
        {"code": "EE 785 07", "name": "Power Electronics", "folder": "EE 785 07 - Power Electronics", "regex": r"^### 9\.4 Power Electronics", "next_regex": r"^### 9\.5 Remote Sensing"},
        {"code": "CT 785 01", "name": "Remote Sensing", "folder": "CT 785 01 - Remote Sensing", "regex": r"^### 9\.5 Remote Sensing", "next_regex": r"^### 9\.6 XML"},
        {"code": "CT 785 05", "name": "XML Foundations, Techniques and Applications", "folder": "CT 785 05 - XML Foundations, Techniques and Applications", "regex": r"^### 9\.6 XML", "next_regex": r"^### 9\.7 Artificial Intelligence"},
        {"code": "CT 785 06", "name": "Artificial Intelligence", "folder": "CT 785 06 - Artificial Intelligence", "regex": r"^### 9\.7 Artificial Intelligence", "next_regex": r"^### 9\.8 Speech Processing"},
        {"code": "CT 785 08", "name": "Speech Processing", "folder": "CT 785 08 - Speech Processing", "regex": r"^### 9\.8 Speech Processing", "next_regex": r"^## 10\. Source Notes"},
    ]

    el3_catalog_md = "# Elective III Options Catalog (BEI IV-II)\n\n| Code | Title | Status |\n|---|---|---|\n"
    for opt in elective_iii_options:
        opt_path = el3_dir / opt["folder"]
        if not opt_path.exists():
            print(f"[CREATE DIR] {opt_path}")
            if not dry_run:
                opt_path.mkdir(parents=True, exist_ok=True)
        else:
            print(f"[PRESERVE DIR] {opt_path}")

        extracted = extract_section(full_syllabus, opt["regex"], opt["next_regex"])
        if extracted and not dry_run:
            syl_path = opt_path / "Syllabus.md"
            with open(syl_path, "w", encoding="utf-8") as f:
                f.write(f"# {opt['name']} ({opt['code']})\n\n{extracted}\n")

        status = "Active Resources Present (24 files)" if opt["folder"] == "Multimedia System" else "Placeholder Scaffolding Ready"
        el3_catalog_md += f"| {opt['code']} | {opt['name']} | {status} |\n"

    if not dry_run:
        with open(el3_dir / "_Elective_III_Options_Catalog.md", "w", encoding="utf-8") as f:
            f.write(el3_catalog_md)
        print("  -> Created Elective III Catalog")

    print("=== Scaffolding Complete Successfully ===")

if __name__ == "__main__":
    is_dry = "--dry-run" in sys.argv
    main(dry_run=is_dry)
