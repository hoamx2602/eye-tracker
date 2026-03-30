'use client';

import React, { useState } from 'react';
import Modal from './ui/Modal';

export type DemographicsData = {
  age: number | '';
  gender: string;
  country: string;
  eyeConditions: string[];
};

const GENDER_OPTIONS = [
  { value: '', label: 'Prefer not to say' },
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

const COUNTRY_LIST = [
  '', 'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France', 'Japan', 'Vietnam',
  'India', 'Brazil', 'Netherlands', 'Spain', 'Italy', 'South Korea', 'China', 'Singapore', 'Other',
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
    onSubmit({
      age: ageNum,
      gender: gender.trim() || 'prefer_not_to_say',
      country: country.trim() || 'not_specified',
      eyeConditions: eyeConditions.length === 0 ? ['none'] : eyeConditions.filter((x) => x !== 'none'),
    });
  };

  const content = (
    <form onSubmit={handleSubmit} className={`bg-gray-900 border border-gray-700 rounded-3xl shadow-2xl max-w-xl w-full flex flex-col ${isPage ? 'h-[640px]' : 'max-h-[90vh]'}`}>
      <div className="p-6 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">Your information</h2>
        <p className="text-sm text-gray-400 mt-1">Optional demographic data for analysis (non-commercial, educational use only).</p>
      </div>
      <div className="p-6 space-y-5 overflow-y-auto flex-1 scrollbar-invisible">
        {error && (
          <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2">{error}</p>
        )}
        <div>
          <label htmlFor="demographics-age" className="block text-sm font-medium text-gray-300 mb-1">Age *</label>
          <input
            id="demographics-age"
            type="number"
            min={1}
            max={120}
            value={age === '' ? '' : age}
            onChange={(e) => setAge(e.target.value === '' ? '' : parseInt(e.target.value, 10) || '')}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="e.g. 25"
            required
          />
        </div>
        <div>
          <label htmlFor="demographics-gender" className="block text-sm font-medium text-gray-300 mb-1">Gender</label>
          <select
            id="demographics-gender"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {COUNTRY_LIST.map((c) => (
              <option key={c || 'empty'} value={c}>{c || 'Select...'}</option>
            ))}
          </select>
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
