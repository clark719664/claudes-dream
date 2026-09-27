class_name HearthTheme
extends RefCounted
const INK := Color("382a22")
const PAPER := Color("ead7ac")
const LIGHT := Color("fff0ca")
const GOLD := Color("d5a652")
static func box(fill: Color, edge: Color, padding := 4) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = fill
	s.border_color = edge
	s.set_border_width_all(1)
	s.set_content_margin_all(padding)
	s.anti_aliasing = false
	return s
static func panel_style(light := false) -> StyleBoxFlat:
	var s := box(PAPER if light else Color("49372c"), Color("977044"), 7)
	s.set_border_width_all(2)
	s.shadow_color = Color(0.08, 0.06, 0.04, 0.45)
	s.shadow_size = 2
	s.shadow_offset = Vector2(0, 2)
	return s
static func make_theme() -> Theme:
	var t := Theme.new()
	t.default_font = load("res://ui/Silkscreen-Regular.ttf")
	t.default_font_size = 8
	t.set_color("font_color", "Label", LIGHT)
	t.set_color("default_color", "RichTextLabel", LIGHT)
	t.set_font_size("normal_font_size", "RichTextLabel", 8)
	t.set_stylebox("panel", "PanelContainer", panel_style())
	var focus := box(Color.TRANSPARENT, LIGHT, 0)
	focus.draw_center = false
	for kind in ["Button", "OptionButton", "MenuButton"]:
		t.set_stylebox("normal", kind, box(PAPER, Color("98754b")))
		t.set_stylebox("hover", kind, box(LIGHT, GOLD))
		t.set_stylebox("pressed", kind, box(Color("c3bb8a"), Color("8d9d69")))
		t.set_stylebox("disabled", kind, box(Color("76644e"), Color("574535")))
		t.set_stylebox("focus", kind, focus)
		for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
			t.set_color(state, kind, INK)
		t.set_color("font_disabled_color", kind, Color("c4b494"))
	for kind in ["HScrollBar", "VScrollBar"]:
		t.set_stylebox("scroll", kind, box(Color("30271f"), Color("574535"), 0))
		t.set_stylebox("grabber", kind, box(Color("b29666"), Color("5d4632"), 0))
		t.set_stylebox("grabber_highlight", kind, box(GOLD, Color("5d4632"), 0))
		t.set_stylebox("grabber_pressed", kind, box(LIGHT, Color("5d4632"), 0))
	for kind in ["PopupPanel", "PopupMenu", "TooltipPanel"]:
		t.set_stylebox("panel", kind, panel_style())
	t.set_color("font_color", "TooltipLabel", LIGHT)
	t.set_font_size("font_size", "TooltipLabel", 8)
	return t
static func button(text: String, callback: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size.y = 20
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	b.pressed.connect(callback)
	return b
