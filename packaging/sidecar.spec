# PyInstaller spec for the tracker helper the app runs: `aion2-tracker.exe`, a one-folder build
# (starts faster than one-file, which unpacks itself on every launch).
#
#   .venv\Scripts\pyinstaller packaging\sidecar.spec --noconfirm --distpath build\sidecar --workpath build\pyi
#
# The monster-name table goes in as data/npcs_en.json, where aion2_tracker.analyze looks for it,
# the app's soul droppers as data/spawns.json (which pet a crystal's monster drops), and its pet
# list as data/pets.json (each pet's genus, which a crystal's must match).
from PyInstaller.utils.hooks import collect_submodules

a = Analysis(
    ["sidecar_entry.py"],
    pathex=[".."],
    datas=[("../data/npcs_en.json", "data"), ("../app/src/renderer/public/maps/spawns.json", "data"),
           ("../app/src/renderer/src/data/pets.json", "data")],
    # scapy imports its layers by name at runtime.
    hiddenimports=collect_submodules("scapy.layers") + collect_submodules("scapy.arch") + ["lz4.block"],
    excludes=["tkinter", "matplotlib", "IPython", "PIL", "pytest", "cryptography"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="aion2-tracker", console=True, icon="../app/build/icon.ico")
coll = COLLECT(exe, a.binaries, a.datas, name="aion2-tracker")
