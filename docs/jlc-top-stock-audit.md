# JLC top-stock footprint audit

This audit samples the highest-stock part returned by representative
[`jlcsearch.tscircuit.com`](https://jlcsearch.tscircuit.com/) category routes.
It intentionally samples categories instead of taking the global top seven,
because the global inventory ranking is almost entirely duplicate 0402 and 0603
passive geometries.

Run the live audit with:

```sh
bun run audit:jlc
```

The command fetches the current category leaders, converts their EasyEDA
footprints to Circuit JSON, runs discovery, prints the best candidate, and exits
non-zero when any copper IoU is below 98%.

## 2026-07-13 snapshot

| Category | Part | Stock | Package | Best result | Copper IoU | Decision |
| --- | --- | ---: | --- | --- | ---: | --- |
| Microcontrollers | C8734 STM32F103C8T6 | 214,596 | LQFP-48(7x7) | `qfn48_p0.4999mm_h10.1999mm_pw0.27mm_pl1.5mm` | 97.62% | Propose pill-pad support for LQFP |
| LDOs | C347215 HT7533S | 103,933 | SOT-23 | `ssop3_p1.1414mm_w2.201mm_pw0.7189mm_pl1.2838mm` | 22.61% | Propose SOT row-span and rotation support |
| USB-C connectors | C2765186 TYPE-C 16PIN 2MD(073) | 735,053 | SMD | no candidate | 0% | Propose a USB-C family |
| Switches | C318884 TS-1187A-B-A-B | 918,009 | SMD-4P,5.1x5.1mm | `dfn4_p3.6998mm_w7mm_pw0.75mm` | 100% | Fixed by lower-quartile pitch inference |
| Gyroscopes | C967633 LSM6DS3TR-C | 47,071 | LGA-14(2.5x3) | `qfn14_p0.4878mm_w3.3692mm_h2.8921mm_pw0.2804mm_pl0.6759mm` | 37.14% | Propose centered 4/3 LGA side distribution |
| MOSFETs | C22446827 L2N7002SLLT1G | 12,704,503 | SOT-23 | `dfn3_p1.2354mm_w3.3267mm_pw0.5172mm_pl1.0665mm` | 12.08% | Propose SOT row-span and rotation support |
| ADCs | C6705483 HX711 | 113,004 | SOP-16 | `ssop16_w3.6825mm_pw0.9735mm_pl0.5567mm` | 14.89% | Propose global rotation and pill pads |

The highest-stock global non-passive two-pad parts sampled separately—C2286,
C84256, C7420372, and C965799—already recover at 100% copper IoU through the
parameterized two-pad footprint.

## Discovery patch

Two-sided and 2-by-2 footprints previously mixed the lead pitch with the larger
row-to-row span. Selecting the lower quartile of repeated coordinate differences
recovers these exact geometries:

- C9002 X322512MSB4SI: 93.94% to 100%
- C139797 SKRPACE010: 83.85% to 100%
- C318884 TS-1187A-B-A-B: 100%

## Proposed footprinter strings

These strings describe the missing DSL capabilities. They are proposals and do
not parse to the stated geometry in `@tscircuit/footprinter` yet.

- Add generic `_rot90` and `_rot180` suffixes that transform every generated
  copper pad.
- Make `w` control the total SOT copper span instead of parsing it while keeping
  the pad X coordinates hard-coded:
  - `sot23_p0.95mm_w3.2402mm_pw0.532mm_pl1.0375mm_rot180` for C22446827.
  - `sot23_p0.95mm_w3.7498mm_pw0.7mm_pl1.25mm_rot180` for C347215.
  - `sot25_p0.95mm_w3.2001mm_pw0.6mm_pl1mm_rot180` for C23380830.
- Add pill pads to quad packages:
  `lqfp48_p0.5mm_w7mm_h7mm_pw0.27mm_pl1.5mm_pillpads` for C8734.
- Add pill pads plus rotation to SOIC:
  `soic16_p1.27mm_w7.49mm_pw0.56mm_pl1.745mm_pillpads_rot90` for C6705483.
- Add centered, explicit side counts for LGA:
  `lga14_grid4x3_p0.5mm_w3.199mm_h2.7mm_pw0.28mm_pl0.675mm` for C967633.
- Add two-row exposed-pad packages:
  `uson8_p0.5mm_w3.615mm_pw0.28mm_pl0.6mm_thermalpad1.7mmx0.3mm` for C2843335.
- Start the common connector as a fixed family:
  `usb_c_receptacle_16pin_2md_073` for C2765186. Once more connector variants
  are audited, shared signal-pitch and mounting-hole dimensions can become
  parameters without making the first string excessively verbose.

Semantic aliases such as `crystal4_...` and `tactile_switch4_...` would improve
readability, but they are not needed to cross the copper-IoU threshold because
the existing parameterized `dfn4` geometry is exact.
