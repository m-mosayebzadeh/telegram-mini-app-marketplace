"""
Unit tests for app.core.storage — exercising save_photo_files() and its
blurred-copy logic directly, at the function level. These complement
the HTTP-level tests in test_photo_endpoints.py, which cover the routes
built on top of this module but can't easily assert on pixel
dimensions or orientation the way these tests do.
"""

import io

from fastapi import UploadFile
from PIL import Image

from app.core.storage import save_photo_files
from tests.helpers import make_test_image_bytes, make_test_image_bytes_with_orientation


def _upload_file(data: bytes, filename: str = "test.jpg") -> UploadFile:
    """
    A minimal UploadFile wrapping in-memory bytes. save_photo_files()
    only ever reads .file and .filename off of it, so we don't need a
    real HTTP request to exercise it directly.
    """
    return UploadFile(file=io.BytesIO(data), filename=filename)


def test_no_blur_requested_only_saves_the_original():
    original_path, blurred_path = save_photo_files(
        1, _upload_file(make_test_image_bytes()), should_blur=False
    )

    assert blurred_path is None
    with open(original_path, "rb") as f:
        assert f.read()  # the original file genuinely exists and has bytes


def test_blur_produces_a_visibly_different_file():
    original_path, blurred_path = save_photo_files(
        1, _upload_file(make_test_image_bytes()), should_blur=True
    )

    assert blurred_path is not None
    with open(original_path, "rb") as f:
        original_bytes = f.read()
    with open(blurred_path, "rb") as f:
        blurred_bytes = f.read()
    assert original_bytes != blurred_bytes


def test_blurred_copy_keeps_the_same_display_size():
    """
    The blurred copy shrinks the photo down and stretches it back up
    internally (that's what makes it look "frosted" instead of just
    hazy), but the file we actually save must still match the
    original's on-screen size exactly.
    """
    _, blurred_path = save_photo_files(
        1, _upload_file(make_test_image_bytes()), should_blur=True
    )

    with Image.open(blurred_path) as blurred:
        assert blurred.size == (40, 40)  # make_test_image_bytes() is 40x40


def test_blur_corrects_exif_rotation_instead_of_carrying_it_sideways():
    """
    Regression test: the blurred copy used to come out rotated even
    though the original displayed fine. A phone photo taken sideways is
    commonly stored as raw 60x40 pixels plus an EXIF tag saying "rotate
    90 to display" — a normal viewer honors that tag when opening the
    *original* file (so it looks like a correct 40x60 photo), but
    Pillow drops the tag when it re-saves the blurred copy. So the
    rotation must be physically baked into the blurred copy's pixels
    instead: saved as 40x60, not left as 60x40.
    """
    sideways_jpeg = make_test_image_bytes_with_orientation(orientation=6, size=(60, 40))

    _, blurred_path = save_photo_files(1, _upload_file(sideways_jpeg), should_blur=True)

    with Image.open(blurred_path) as blurred:
        assert blurred.size == (40, 60)
