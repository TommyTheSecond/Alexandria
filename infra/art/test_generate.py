from PIL import Image

from generate import render, rows_for

TEXT = "I celebrate myself, And what I assume you shall assume"


def gradient(w=60, h=40):
    img = Image.new("L", (w, h))
    img.putdata([int(255 * x / (w - 1)) for _ in range(h) for x in range(w)])
    return img


def test_generate_is_deterministic():
    assert render(gradient(), TEXT, 72) == render(gradient(), TEXT, 72)


def test_line_widths_match_cols():
    img = gradient(120, 80)
    for cols in (100, 72, 40):
        lines = render(img, TEXT, cols)
        assert len(lines) == rows_for(cols, img.width, img.height)
        assert all(len(line) == cols for line in lines)


def test_rows_use_half_height_for_character_aspect():
    assert rows_for(100, 1000, 1000) == 50


def test_dark_pixels_take_letters_in_sequence():
    lines = render(Image.new("L", (10, 10), 0), "Abc, de!", 6)
    assert "".join(lines) == "AbcdeAbcdeAbcdeAbc"  # 6 cols x 3 rows, letters only, wrapping


def test_light_pixels_are_spaces_and_mid_tones_are_dots():
    assert set("".join(render(Image.new("L", (10, 4), 255), TEXT, 6))) == {" "}
    assert set("".join(render(Image.new("L", (10, 4), 128), TEXT, 6))) <= {":", "."}
