export type FacialSpeechDomain = 'face' | 'speech';

export interface FacialSpeechTask {
  id: string;
  domain: FacialSpeechDomain;
  title: string;
  instruction: string;
  durationSec: number;
  clinicalAnchor: string;
  captureNotes: string;
}

export interface MetricDefinition {
  id: string;
  domain: FacialSpeechDomain | 'quality';
  label: string;
  unit: string;
  purpose: string;
}

/**
 * Fixed capture battery. It deliberately follows the standard facial movements
 * used in NIHSS/Sunnybrook-style video examination and separates speech tasks
 * by the motor subsystem they stress. Keep task IDs stable: offline reports use
 * their time windows as the ground truth for feature extraction.
 */
export const FACIAL_SPEECH_TASKS: FacialSpeechTask[] = [
  {
    id: 'face_rest',
    domain: 'face',
    title: 'Khuôn mặt ở trạng thái nghỉ',
    instruction: 'Nhìn thẳng vào camera, thả lỏng khuôn mặt và không nói.',
    durationSec: 5,
    clinicalAnchor: 'Sunnybrook: resting symmetry',
    captureNotes: 'Giữ đầu thẳng, cả hai tai và cằm nằm trong khung hình.',
  },
  {
    id: 'face_brow_raise',
    domain: 'face',
    title: 'Nâng lông mày',
    instruction: 'Nâng đều cả hai lông mày, giữ 2 giây, rồi thả lỏng. Lặp lại hai lần.',
    durationSec: 8,
    clinicalAnchor: 'NIHSS facial-palsy cue; Sunnybrook voluntary movement',
    captureNotes: 'Không ngửa đầu hoặc nghiêng đầu để bù trừ.',
  },
  {
    id: 'face_eye_closure',
    domain: 'face',
    title: 'Nhắm mắt',
    instruction: 'Nhắm chặt cả hai mắt, giữ 2 giây, rồi mở ra. Lặp lại hai lần.',
    durationSec: 8,
    clinicalAnchor: 'NIHSS facial-palsy cue; eye-closure function',
    captureNotes: 'Không che mặt, giữ mặt hướng thẳng camera.',
  },
  {
    id: 'face_smile_show_teeth',
    domain: 'face',
    title: 'Cười và để lộ răng',
    instruction: 'Cười rộng và để lộ răng, giữ 2 giây, rồi thả lỏng. Lặp lại hai lần.',
    durationSec: 8,
    clinicalAnchor: 'NIHSS: show teeth; Sunnybrook: open-mouth smile',
    captureNotes: 'Đây là cửa sổ chính để đo độ lệch miệng và biên độ cười hai bên.',
  },
  {
    id: 'face_lip_pucker',
    domain: 'face',
    title: 'Chu môi',
    instruction: 'Chu môi hướng về phía trước, giữ 2 giây, rồi thả lỏng. Lặp lại hai lần.',
    durationSec: 8,
    clinicalAnchor: 'Sunnybrook: lip pucker',
    captureNotes: 'Không di chuyển đầu hoặc vai.',
  },
  {
    id: 'speech_sustained_a',
    domain: 'speech',
    title: 'Giữ nguyên âm /a/',
    instruction: 'Hít vào, sau đó phát âm “a” đều và thoải mái khoảng 5 giây. Nghỉ ngắn và lặp lại 3 lần.',
    durationSec: 22,
    clinicalAnchor: 'Maximum phonation / acoustic voice quality',
    captureNotes: 'Ngồi cách micro ổn định, không thay đổi âm lượng có chủ ý.',
  },
  {
    id: 'speech_ddk_patka',
    domain: 'speech',
    title: 'Diadochokinesis: pa-ta-ka',
    instruction: 'Nói “pa-ta-ka” rõ ràng, đều, nhanh vừa phải trong 10 giây. Nghỉ ngắn và lặp lại một lần.',
    durationSec: 24,
    clinicalAnchor: 'Sequential motion rate / dysarthria motor-speech assessment',
    captureNotes: 'Không biến thành hát; tốc độ tự nhiên nhưng đều quan trọng hơn tốc độ tối đa.',
  },
  {
    id: 'speech_reading',
    domain: 'speech',
    title: 'Đọc câu cố định',
    instruction: 'Đọc rõ ràng: “Hôm nay trời sáng. Tôi nói rõ ràng và đều đặn.” Lặp lại hai lần.',
    durationSec: 18,
    clinicalAnchor: 'NIHSS dysarthria-style intelligibility sample',
    captureNotes: 'Câu cố định cho phép ASR/phoneme alignment và so sánh lặp lại.',
  },
  {
    id: 'speech_counting',
    domain: 'speech',
    title: 'Đếm số',
    instruction: 'Đếm từ 1 đến 20 với tốc độ nói tự nhiên và rõ ràng.',
    durationSec: 18,
    clinicalAnchor: 'Connected-speech rate, pausing, intelligibility',
    captureNotes: 'Không cần nói nhanh; giữ khoảng cách tới micro không đổi.',
  },
];

export const FACIAL_SPEECH_METRICS: MetricDefinition[] = [
  { id: 'capture_face_visibility', domain: 'quality', label: 'Tỷ lệ khung hình có mặt hợp lệ', unit: '%', purpose: 'Gating: chỉ chấm điểm nếu mặt nhìn thẳng và landmark ổn định.' },
  { id: 'capture_audio_snr', domain: 'quality', label: 'SNR / mức ồn nền', unit: 'dB', purpose: 'Gating: tránh diễn giải chỉ số giọng nói từ audio quá ồn.' },
  { id: 'head_pose_stability', domain: 'quality', label: 'Độ ổn định tư thế đầu', unit: 'deg', purpose: 'Loại sai lệch hình học do xoay/nghiêng đầu.' },
  { id: 'resting_asymmetry', domain: 'face', label: 'Bất đối xứng khi nghỉ', unit: 'ratio', purpose: 'Khoảng cách/độ cao chuẩn hoá giữa mắt, lông mày, khoé miệng.' },
  { id: 'smile_excursion_ratio', domain: 'face', label: 'Tỷ số biên độ cười trái/phải', unit: 'ratio', purpose: 'Đo giảm vận động một bên ở động tác cười/show-teeth.' },
  { id: 'mouth_corner_vertical_asymmetry', domain: 'face', label: 'Độ chênh cao khoé miệng', unit: 'IPD-normalised', purpose: 'Dấu hiệu facial droop ở phần dưới mặt.' },
  { id: 'brow_excursion_ratio', domain: 'face', label: 'Tỷ số nâng lông mày trái/phải', unit: 'ratio', purpose: 'Đo chức năng upper face trong động tác chủ ý.' },
  { id: 'eye_closure_asymmetry', domain: 'face', label: 'Bất đối xứng nhắm mắt', unit: 'ratio', purpose: 'So sánh eye aperture/blink blendshape hai bên.' },
  { id: 'au_left_right_delta', domain: 'face', label: 'Chênh lệch Facial Action Unit hai bên', unit: 'score', purpose: 'AU12/AU6, eyebrow, blink và lip-corner activation.' },
  { id: 'sustained_f0', domain: 'speech', label: 'F0 và độ biến thiên F0', unit: 'Hz', purpose: 'Độ ổn định cao độ trong nguyên âm kéo dài.' },
  { id: 'jitter_shimmer_hnr', domain: 'speech', label: 'Jitter, shimmer, HNR', unit: '% / % / dB', purpose: 'Độ tuần hoàn và chất lượng giọng trong cửa sổ nguyên âm.' },
  { id: 'maximum_phonation_time', domain: 'speech', label: 'Thời gian phát âm tối đa', unit: 's', purpose: 'Theo dõi thời lượng /a/ hợp lệ, không dùng đơn lẻ để chẩn đoán.' },
  { id: 'ddk_rate_regularity', domain: 'speech', label: 'Tốc độ và độ đều pa-ta-ka', unit: 'syllables/s, CV', purpose: 'Đánh giá timing và tính đều của vận động phát âm liên tiếp.' },
  { id: 'connected_speech_rate', domain: 'speech', label: 'Tốc độ nói, articulation rate, pause ratio', unit: 'words/s, syllables/s, %', purpose: 'Phân tách nói chậm do pause với tốc độ phát âm thực.' },
  { id: 'asr_alignment', domain: 'speech', label: 'Khớp câu đọc / lỗi từ-âm vị', unit: 'WER, PER, confidence', purpose: 'Intelligibility proxy trên câu cố định; luôn kèm audio quality.' },
  { id: 'prosody', domain: 'speech', label: 'Biến thiên pitch và cường độ', unit: 'Hz / dB', purpose: 'Bổ sung đánh giá monotonicity và kiểm soát hơi-thở.' },
];

export const FACIAL_SPEECH_PROTOCOL_VERSION = '1.0.0';
