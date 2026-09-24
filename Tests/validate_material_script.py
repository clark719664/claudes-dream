"""Runs Content/Python/init_unreal.py against a validating fake `unreal` module built from the
real UE 5.5 generated Python stub, so every class, property, enum and function it touches is
checked without the editor.

Usage (from the repo root):
    git clone --depth 1 https://github.com/DocDooom/unreal-stub Tests/out/unreal-stub
    python3 Tests/validate_material_script.py Content/Python/init_unreal.py
"""
import re, sys, types, inspect
import os
STUB = os.environ.get('UNREAL_STUB', os.path.join(os.path.dirname(__file__), 'out', 'unreal-stub', 'unreal', 'unreal.py'))
SRC = open(STUB, encoding='utf-8-sig').read()
CLASSES = {}
for m in re.finditer(r'^class (\w+)\(([^)]*)\):(.*?)(?=^class |\Z)', SRC, re.M | re.S):
    name, bases, body = m.group(1), [b.strip() for b in m.group(2).split(',') if b.strip()], m.group(3)
    props = dict(re.findall(r'- ``(\w+)`` \(([^)]*)\)', body))
    methods = {}
    for mm in re.finditer(r'^    def (\w+)\((.*?)\)\s*->', body, re.M | re.S):
        methods[mm.group(1)] = mm.group(2)
    enums = set(re.findall(r'^    (\w+): ' + re.escape(name) + r' = \.\.\.', body, re.M))
    CLASSES[name] = dict(bases=bases, props=props, methods=methods, enums=enums)

def lineage(name):
    seen = []
    stack = [name]
    while stack:
        n = stack.pop(0)
        if n in CLASSES and n not in seen:
            seen.append(n); stack += CLASSES[n]['bases']
    return seen

def has_prop(cls, prop):
    return any(prop in CLASSES[c]['props'] for c in lineage(cls))

def has_method(cls, meth):
    return any(meth in CLASSES[c]['methods'] for c in lineage(cls))

ERRORS, LOG = [], []

class Obj:
    def __init__(self, cls, **info):
        self._cls = cls; self._props = {}; self.__dict__.update(info)
    def set_editor_property(self, name, value):
        if not has_prop(self._cls, name):
            ERRORS.append(f'{self._cls}.set_editor_property("{name}") not a property')
        self._props[name] = value
    def get_editor_property(self, name):
        if not has_prop(self._cls, name):
            ERRORS.append(f'{self._cls}.get_editor_property("{name}") not a property')
        return self._props.get(name)
    def get_path_name(self): return f'/Game/Fake/{self._cls}'
    def __repr__(self): return f'<{self._cls}>'

class ClassRef:
    def __init__(self, name): self.name = name
    def __call__(self, *a, **k):
        o = Obj(self.name)
        for k2, v in k.items(): o.set_editor_property(k2, v)
        return o
    def __getattr__(self, attr):
        info = CLASSES[self.name]
        if attr in info['enums']: return f'{self.name}.{attr}'
        if attr in info['methods'] or has_method(self.name, attr):
            return lambda *a, **k: Library.call(self.name, attr, a, k)
        ERRORS.append(f'{self.name}.{attr} does not exist'); return None

ASSETS = {}
class Library:
    @staticmethod
    def call(cls, meth, a, k):
        LOG.append(f'{cls}.{meth}')
        if meth == 'create_material_expression':
            mat, ecls = a[0], a[1]
            return Obj(ecls.name)
        if meth == 'connect_material_expressions':
            src, out, dst, inp = a
            if dst._cls == 'MaterialExpressionCustom':
                names = [i._props.get('input_name') for i in dst._props.get('inputs', [])]
                if inp not in names: ERRORS.append(f'custom input {inp} missing (have {names})'); return False
                return True
            # single-input nodes: accept "" only if the class exists; report what was tried
            LOG.append(f'  link {src._cls} -> {dst._cls}.{inp!r}')
            return True
        if meth == 'connect_material_property':
            prop = a[2]
            if not isinstance(prop, str): ERRORS.append(f'bad material property {prop}')
            return True
        if meth == 'does_asset_exist': return a[0] in ASSETS
        if meth == 'does_directory_exist': return False
        if meth == 'load_asset': return ASSETS[a[0]]
        if meth == 'get_metadata_tag': return ASSETS_META.get(id(a[0]), {}).get(a[1], '')
        if meth == 'set_metadata_tag': ASSETS_META.setdefault(id(a[0]), {})[a[1]] = a[2]; return None
        if meth == 'get_asset_tools': return Obj('AssetTools')
        return True
ASSETS_META = {}

def _asset_tools_create(self, name, path, cls, factory):
    o = Obj(cls.name); ASSETS[f'{path}/{name}'] = o; return o

class Module(types.ModuleType):
    def __getattr__(self, attr):
        if attr in ('log', 'log_warning', 'log_error'):
            return lambda msg: (LOG.append(msg), ERRORS.append(msg) if attr == 'log_error' else None)
        if attr in CLASSES: return ClassRef(attr)
        raise AttributeError(f'unreal.{attr} does not exist')

mod = Module('unreal'); sys.modules['unreal'] = mod
Obj.create_asset = lambda self, *a: _asset_tools_create(self, *a)

def check_methods_used(path):
    """Also statically confirm every `mel.x` / `eal.x` / asset_tools.x call exists with those names."""
    src = open(path).read()
    for lib, cls in (('mel', 'MaterialEditingLibrary'), ('eal', 'EditorAssetLibrary'), ('asset_tools', 'AssetTools')):
        for meth in set(re.findall(r'\b' + lib + r'\.(\w+)\(', src)):
            if not has_method(cls, meth): ERRORS.append(f'{cls}.{meth} missing')

if __name__ == '__main__':
    path = sys.argv[1]
    check_methods_used(path)
    runpy = __import__('runpy')
    for run in (1, 2):
        before = len(LOG)
        runpy.run_path(path, run_name='__main__')
        print(f'run {run}: {sum(1 for l in LOG[before:] if "built" in l)} materials built')
    print('\n'.join(l for l in LOG if l.startswith('  link')))
    print('ERRORS:' if ERRORS else 'NO ERRORS'); print('\n'.join(ERRORS))
