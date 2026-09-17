import { useState } from 'react';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Box,
  ButtonBase,
  Card,
  CardContent,
  Divider,
  Typography,
} from '@mui/material';

import {
  readCollapsedSections,
  writeCollapsedSections,
} from './collapsed-sections';

/*
 * A settings card whose header toggles its content. The header is the hit
 * area, so it is at least 64 px high and carries the open state.
 */
const SettingsSection = ({
  children,
  id,
  subheader,
  title,
}) => {
  const [collapsed, setCollapsed] = useState(
    () => readCollapsedSections().includes(id),
  );

  const toggle = () => {
    const nextCollapsed = !collapsed;
    setCollapsed(nextCollapsed);

    const otherSections = readCollapsedSections().filter(entry => entry !== id);
    writeCollapsedSections(
      nextCollapsed ? [...otherSections, id] : otherSections,
    );
  };

  return (
    <Card>
      <ButtonBase
        aria-expanded={!collapsed}
        onClick={toggle}
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          minHeight: 64,
          paddingX: 'var(--space-4)',
          paddingY: 'var(--space-2)',
          textAlign: 'left',
          width: '100%',
        }}
      >
        <Typography component="h2" variant="sectionTitle">
          {title}
        </Typography>
        <ExpandMoreIcon
          sx={{
            transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 200ms',
          }}
        />
      </ButtonBase>
      {subheader &&
        <Box sx={{ paddingBottom: 'var(--space-2)', paddingX: 'var(--space-4)' }}>
          {subheader}
        </Box>
      }
      {!collapsed &&
        <>
          <Divider />
          <CardContent>{children}</CardContent>
        </>
      }
    </Card>
  );
};

export default SettingsSection;
