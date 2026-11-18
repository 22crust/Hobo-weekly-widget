import React from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
} from "lucide-react";

interface WeatherIconProps {
  code: number;
  className?: string;
}

/**
 * Minimalist fine-line weather forecast icon replacing the Hobonichi moon phase icon.
 */
export const WeatherIcon: React.FC<WeatherIconProps> = ({
  code,
  className = "w-3.5 h-3.5 stroke-[1.4]",
}) => {
  if (code === 0 || code === 1) {
    return <Sun className={className} />;
  }
  if (code === 2) {
    return <CloudSun className={className} />;
  }
  if (code === 3) {
    return <Cloud className={className} />;
  }
  if (code === 45 || code === 48) {
    return <CloudFog className={className} />;
  }
  if (code >= 51 && code <= 57) {
    return <CloudDrizzle className={className} />;
  }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return <CloudRain className={className} />;
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return <CloudSnow className={className} />;
  }
  if (code >= 95) {
    return <CloudLightning className={className} />;
  }
  return <Sun className={className} />;
};
