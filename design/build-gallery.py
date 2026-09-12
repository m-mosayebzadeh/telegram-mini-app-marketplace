"""Builds design/ember-ui-kit.html by inlining the app's REAL stylesheets
into design/gallery-shell.html.

The gallery has to be the app, not a picture of it — if it were hand-written
CSS it would drift from the product within a week. Re-run this after any
change under frontend/src/styles/ and republish.

    python design/build-gallery.py
"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STYLES = os.path.join(ROOT, 'frontend', 'src', 'styles')
SHELL = os.path.join(ROOT, 'design', 'gallery-shell.html')
OUT = os.path.join(ROOT, 'design', 'ember-ui-kit.html')

COMPONENTS = ('button.css', 'chip.css', 'discover.css', 'header.css',
              'input.css', 'list.css', 'nav.css', 'offer.css', 'profile.css',
              'sheet.css', 'states.css')

# The Telegram kit bridge is app-only plumbing with nothing to show.
KIT_BRIDGE = '/* ---------------------------------------------------------------------\n   Telegram UI kit bridge'


def read(*parts):
    return io.open(os.path.join(STYLES, *parts), encoding='utf-8').read()


def build():
    css = [read('tokens.css'), read('base.css').split(KIT_BRIDGE)[0]]
    css.extend(read('components', name) for name in COMPONENTS)
    app_css = '\n\n'.join(css)

    shell = io.open(SHELL, encoding='utf-8').read()
    if '/*__APP_CSS__*/' not in shell:
        raise SystemExit('gallery-shell.html lost its /*__APP_CSS__*/ marker')

    page = shell.replace('/*__APP_CSS__*/', app_css)
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(page)
    print('%s  (%.1f KB, %.1f KB of it real app CSS)'
          % (os.path.relpath(OUT, ROOT), len(page) / 1024, len(app_css) / 1024))


if __name__ == '__main__':
    build()
