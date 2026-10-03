
'use client';

import { useEffect, useState } from 'react';

type Company = {
  id: number;
  name: string;
  emailDomain: string;
};

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [name, setName] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  async function fetchCompanies() {
    const response = await fetch(`${apiUrl}/companies`);
    if (!response.ok) throw new Error('Failed to fetch companies');
    setCompanies(await response.json());
  }

  useEffect(() => {
    fetchCompanies().catch(console.error);
  }, []);

  async function addCompany(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch(`${apiUrl}/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, emailDomain }),
      });

      if (!response.ok) throw new Error('Failed to add company');

      setName('');
      setEmailDomain('');
      await fetchCompanies();
    } catch (error) {
      console.error(error);
      alert('Could not add company. Check that the backend is running.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 32, maxWidth: 700, margin: 'auto' }}>
      <h1>Companies</h1>

      <form onSubmit={addCompany} style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        <input
          placeholder="Company name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          placeholder="Email domain (e.g. acme.com)"
          value={emailDomain}
          onChange={(e) => setEmailDomain(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Adding...' : 'Add Company'}
        </button>
      </form>

      <h2 style={{ marginTop: 32 }}>Company List</h2>
      {companies.map((company) => (
        <div key={company.id} style={{ padding: 12, borderBottom: '1px solid #ddd' }}>
          <strong>{company.name}</strong>
          <div>{company.emailDomain}</div>
        </div>
      ))}
    </main>
  );
}
