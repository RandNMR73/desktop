// Compare the exact qcms destination proposed for macOS with CoreGraphics.
// This exercises the vendored conversion library, not a copied matrix.
use qcms::{DataType, Intent, Profile, Transform};

fn main() {
    let srgb = Profile::new_sRGB();
    let p3 = Profile::new_cicp(12u8.into(), 13u8.into()).expect("Display P3");
    let to_p3 = Transform::new(&srgb, &p3, DataType::RGBA8, Intent::Perceptual)
        .expect("sRGB to Display P3");
    let identity = Transform::new(&p3, &p3, DataType::RGBA8, Intent::Perceptual)
        .expect("Display P3 identity");
    for r in (0u16..=255).step_by(17) {
        for g in (0u16..=255).step_by(17) {
            for b in (0u16..=255).step_by(17) {
                for alpha in [0u8, 1, 127, 254, 255] {
                    let original = [r as u8, g as u8, b as u8, alpha];
                    let mut converted = original;
                    to_p3.apply(&mut converted);
                    assert_eq!(converted[3], alpha);
                    let mut same = original;
                    identity.apply(&mut same);
                    assert_eq!(same, original);
                    if alpha == 255 {
                        println!("{r},{g},{b},{},{},{}", converted[0], converted[1], converted[2]);
                    }
                }
            }
        }
    }
}
