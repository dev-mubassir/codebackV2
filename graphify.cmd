@echo off
python -c "import sys; sys.path.insert(0, r'C:\Users\mubas\AppData\Roaming\uv\tools\graphifyy\Lib\site-packages'); from runpy import run_module; sys.argv=['graphify'] + sys.argv[1:]; run_module('graphify', run_name='__main__')" %*
