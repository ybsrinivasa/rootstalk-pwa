// 2026-06-06 — Spec-faithful URL for the QR-encoded crop-record link
// (BL-16). Backend's crop_record_public_url helper builds
// `{base}/crop-record/{ref}`; the original PWA page lives at
// `/crop/[referenceNumber]`. Render the same component so both
// paths work.
import CropPublicPage from '../../crop/[referenceNumber]/page'

export default CropPublicPage
