#![allow(non_snake_case, dead_code)]

#[derive(Clone, Debug, PartialEq)]
enum Paint {
    None,
    Black,
    Green,
    Blue,
    Red,
    Transparent,
    CurrentColor,
    Server(&'static str),
}

mod longhands {
    pub mod fill {
        pub mod computed_value {
            pub(super) use crate::Paint;
            pub type T = Paint;
        }
    }
    pub mod stroke {
        pub mod computed_value {
            pub(super) use crate::Paint;
            pub type T = Paint;
        }
    }
}

#[derive(Clone)]
struct GeckoInheritedSVG {
    mFill: Paint,
    mStroke: Paint,
    mFillIsInitialPaint: bool,
    mStrokeIsInitialPaint: bool,
}

impl Default for GeckoInheritedSVG {
    fn default() -> Self {
        Self {
            mFill: Paint::Black,
            mStroke: Paint::None,
            mFillIsInitialPaint: true,
            mStrokeIsInitialPaint: true,
        }
    }
}

// GENERATED_SETTERS

#[test]
fn equal_explicit_defaults_keep_initial_state() {
    let mut s = GeckoInheritedSVG::default();
    s.set_fill(Paint::Black);
    s.set_stroke(Paint::None);
    assert!(s.mFillIsInitialPaint);
    assert!(s.mStrokeIsInitialPaint);
}

#[test]
fn defaults_after_inherited_color_are_explicit() {
    let mut parent = GeckoInheritedSVG::default();
    parent.set_fill(Paint::Green);
    parent.set_stroke(Paint::Green);
    let mut child = parent.clone();
    child.set_fill(Paint::Black);
    child.set_stroke(Paint::None);
    assert!(!child.mFillIsInitialPaint);
    assert!(!child.mStrokeIsInitialPaint);
}

#[test]
fn initial_after_different_inherited_paint_restores_fallback() {
    let initial = GeckoInheritedSVG::default();
    let mut s = initial.clone();
    s.set_fill(Paint::Green);
    s.set_stroke(Paint::Green);
    s.reset_fill(&initial);
    s.reset_stroke(&initial);
    assert_eq!(s.get_fill(), &Paint::Black);
    assert_eq!(s.get_stroke(), &Paint::None);
    assert!(s.mFillIsInitialPaint);
    assert!(s.mStrokeIsInitialPaint);
}

#[test]
fn initial_after_equal_noninitial_paint_keeps_explicit_state() {
    let initial = GeckoInheritedSVG::default();
    let mut s = initial.clone();
    s.set_fill(Paint::Green);
    s.set_stroke(Paint::Green);
    s.set_fill(Paint::Black);
    s.set_stroke(Paint::None);
    s.reset_fill(&initial);
    s.reset_stroke(&initial);
    assert!(!s.mFillIsInitialPaint);
    assert!(!s.mStrokeIsInitialPaint);
}

#[test]
fn inheritance_copies_state_only_when_the_paint_changes() {
    let initial = GeckoInheritedSVG::default();
    let mut parent = initial.clone();
    parent.set_fill(Paint::Green);
    parent.set_stroke(Paint::Green);
    let mut child = initial.clone();
    child.copy_fill_from(&parent);
    child.copy_stroke_from(&parent);
    assert_eq!(child.get_fill(), &Paint::Green);
    assert_eq!(child.get_stroke(), &Paint::Green);
    assert!(!child.mFillIsInitialPaint);
    assert!(!child.mStrokeIsInitialPaint);
    child.set_fill(Paint::Black);
    child.set_stroke(Paint::None);
    child.copy_fill_from(&initial);
    child.copy_stroke_from(&initial);
    assert!(!child.mFillIsInitialPaint);
    assert!(!child.mStrokeIsInitialPaint);
}

#[test]
fn none_and_transparency_are_explicit_fill_values() {
    for value in [Paint::None, Paint::Transparent] {
        let mut s = GeckoInheritedSVG::default();
        s.set_fill(value.clone());
        assert_eq!(s.get_fill(), &value);
        assert!(!s.mFillIsInitialPaint);
    }
}

#[test]
fn currentcolor_is_distinct_from_black_before_resolution() {
    let mut s = GeckoInheritedSVG::default();
    s.set_fill(Paint::CurrentColor);
    assert!(!s.mFillIsInitialPaint);
    assert_eq!(s.get_fill(), &Paint::CurrentColor);
}

#[test]
fn fill_and_stroke_state_are_independent() {
    let mut s = GeckoInheritedSVG::default();
    s.set_fill(Paint::Red);
    assert!(s.mStrokeIsInitialPaint);
    s.set_stroke(Paint::Blue);
    s.reset_fill(&GeckoInheritedSVG::default());
    assert!(s.mFillIsInitialPaint);
    assert!(!s.mStrokeIsInitialPaint);
    assert_eq!(s.get_stroke(), &Paint::Blue);
}

#[test]
fn paint_server_changes_invalidate_initial_state() {
    let mut s = GeckoInheritedSVG::default();
    s.set_fill(Paint::Server("gradient"));
    s.set_stroke(Paint::Server("pattern"));
    assert!(!s.mFillIsInitialPaint);
    assert!(!s.mStrokeIsInitialPaint);
    let child = s.clone();
    assert!(child.fill_equals(&s));
    assert!(child.stroke_equals(&s));
}

#[test]
fn style_comparisons_distinguish_equal_paint_with_different_fallback() {
    let initial = GeckoInheritedSVG::default();
    let mut s = initial.clone();
    s.set_fill(Paint::Red);
    s.set_stroke(Paint::Red);
    s.set_fill(Paint::Black);
    s.set_stroke(Paint::None);
    assert_eq!(s.slow_clone_fill(), initial.slow_clone_fill());
    assert_eq!(s.slow_clone_stroke(), initial.slow_clone_stroke());
    assert!(!s.fill_equals(&initial));
    assert!(!s.stroke_equals(&initial));
}
