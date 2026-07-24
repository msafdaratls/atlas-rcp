"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type BrandingState = {
  organisationName: string;
  organisationLogoUrl: string | null;
  setOrganisationLogoUrl: (url: string | null) => void;
  setOrganisationName: (name: string) => void;
};

const BrandingContext = createContext<BrandingState | null>(null);

export function OrganisationBrandingProvider({
  organisationName,
  organisationLogoUrl,
  children,
}: {
  organisationName: string;
  organisationLogoUrl?: string | null;
  children: ReactNode;
}) {
  const [logoUrl, setLogoUrl] = useState<string | null>(
    organisationLogoUrl ?? null,
  );
  const [name, setName] = useState(organisationName);

  const setOrganisationLogoUrl = useCallback((url: string | null) => {
    setLogoUrl(url);
  }, []);

  const setOrganisationName = useCallback((next: string) => {
    setName(next);
  }, []);

  const value = useMemo(
    () => ({
      organisationName: name,
      organisationLogoUrl: logoUrl,
      setOrganisationLogoUrl,
      setOrganisationName,
    }),
    [name, logoUrl, setOrganisationLogoUrl, setOrganisationName],
  );

  return (
    <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
  );
}

export function useOrganisationBranding(): BrandingState {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    throw new Error("useOrganisationBranding requires provider");
  }
  return ctx;
}

export function useOrganisationBrandingOptional(): BrandingState | null {
  return useContext(BrandingContext);
}
