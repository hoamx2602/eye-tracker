'use client';

import React, { useState } from 'react';
import Modal from './ui/Modal';

export type DemographicsData = {
  age: number | '';
  gender: string;
  country: string;
  device: string;
  eyeConditions: string[];
  wearsGlasses: boolean;
};

import countriesData from '@/lib/countries.json';

const GENDER_OPTIONS = [
  { value: '', label: 'Select...' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

const EYE_CONDITION_OPTIONS = [
  { id: 'none', label: 'None' },
  { id: 'myopia', label: 'Myopia (nearsightedness)' },
  { id: 'hyperopia', label: 'Hyperopia (farsightedness)' },
  { id: 'astigmatism', label: 'Astigmatism' },
  { id: 'presbyopia', label: 'Presbyopia' },
  { id: 'strabismus', label: 'Strabismus' },
  { id: 'amblyopia', label: 'Amblyopia (lazy eye)' },
  { id: 'dry_eye', label: 'Dry eye' },
  { id: 'cataract', label: 'Cataract' },
  { id: 'glaucoma', label: 'Glaucoma' },
  { id: 'other', label: 'Other' },
];

type DemographicsFormProps = {
  onSubmit: (data: DemographicsData) => void;
  onBack?: () => void;
  isPage?: boolean;
};

export default function DemographicsForm({ onSubmit, onBack, isPage = false }: DemographicsFormProps) {
  const [age, setAge] = useState<number | ''>('');
  const [gender, setGender] = useState('');
  const [country, setCountry] = useState('');
  const [eyeConditions, setEyeConditions] = useState<string[]>([]);
  const [wearsGlasses, setWearsGlasses] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleEyeCondition = (id: string) => {
    if (id === 'none') {
      setEyeConditions((prev) => (prev.length === 0 ? ['none'] : []));
      return;
    }
    setEyeConditions((prev) => {
      const withoutNone = prev.filter((x) => x !== 'none');
      if (prev.includes(id)) return withoutNone.filter((x) => x !== id);
      return [...withoutNone, id];
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const ageNum = age === '' ? NaN : Number(age);
    if (Number.isNaN(ageNum) || ageNum < 1 || ageNum > 120) {
      setError('Please enter a valid age (1–120).');
      return;
    }
    if (!gender) {
      setError('Please select your gender.');
      return;
    }
    onSubmit({
      age: ageNum,
      gender: gender.trim(),
      country: country.trim() || 'not_specified',
      device: 'not_specified',
      eyeConditions: eyeConditions.length === 0 ? ['none'] : eyeConditions.filter((x) => x !== 'none'),
      wearsGlasses,
    });
  };

  const content = (
    <form onSubmit={handleSubmit} className={`bg-gray-900 border border-gray-700 rounded-3xl shadow-2xl max-w-xl w-full flex flex-col ${isPage ? 'h-[640px]' : 'max-h-[90vh]'}`}>
      <div className="p-6 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">Your information</h2>
        <p className="text-sm text-gray-400 mt-1">Optional demographic data for analysis.</p>
      </div>
      <div className="p-6 space-y-5 overflow-y-auto flex-1 scrollbar-invisible">
        {error && (
          <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2">{error}</p>
        )}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label htmlFor="demographics-age" className="block text-sm font-medium text-gray-300 mb-1">Age *</label>
            <input
              id="demographics-age"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={age === '' ? '' : age}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9]/g, '');
                if (val === '') {
                  setAge('');
                  return;
                }
                const num = parseInt(val, 10);
                if (num <= 120) {
                  setAge(num);
                }
              }}
              className="h-11 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g. 25"
              required
            />
          </div>
          <div>
            <label htmlFor="demographics-gender" className="block text-sm font-medium text-gray-300 mb-1">Gender *</label>
            <select
              id="demographics-gender"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="h-11 w-full px-3 pr-9 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem_1.25rem] bg-[right_0.5rem_center] bg-no-repeat"
              required
            >
              {GENDER_OPTIONS.map((o) => (
                <option key={o.value || 'empty'} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="demographics-country" className="block text-sm font-medium text-gray-300 mb-1">Country</label>
            <select
              id="demographics-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="h-11 w-full px-3 pr-9 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem_1.25rem] bg-[right_0.5rem_center] bg-no-repeat"
            >
              <option value="">Select...</option>
              {countriesData.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.flag} {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Glasses question — drives the glasses-optimization feature flag */}
        <div>
          <span className="block text-sm font-medium text-gray-300 mb-2">Do you wear glasses?</span>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Yes — I wear glasses', value: true },
              { label: 'No / Contact lenses', value: false },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => setWearsGlasses(opt.value)}
                className={`relative py-3 px-4 rounded-xl border-2 text-sm font-medium text-left transition ${
                  wearsGlasses === opt.value
                    ? 'bg-blue-600/20 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                <span className={`inline-block w-3.5 h-3.5 rounded-full border-2 mr-2 align-middle ${
                  wearsGlasses === opt.value ? 'bg-blue-500 border-blue-400' : 'border-gray-500'
                }`} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-300 mb-2">Eye conditions (check any that apply)</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {EYE_CONDITION_OPTIONS.map((opt) => (
              <label key={opt.id} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={eyeConditions.includes(opt.id)}
                  onChange={() => toggleEyeCondition(opt.id)}
                  className="rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="p-6 border-t border-gray-700 flex gap-3 justify-end">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded-xl transition"
          >
            Back
          </button>
        )}
        <button
          type="submit"
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition"
        >
          Next
        </button>
      </div>
    </form>
  );

  if (isPage) {
    return content;
  }

  return (
    <Modal open zIndexClassName="z-[100]" size="md" className="overflow-y-auto">
      {content}
    </Modal>
  );
}
