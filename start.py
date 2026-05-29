"""تشغيل السيرفر — استخدم هذا الملف أو run.bat"""
from pathlib import Path

if __name__ == "__main__":
    import runpy

    runpy.run_path(str(Path(__file__).resolve().parent / "1.py"), run_name="__main__")
