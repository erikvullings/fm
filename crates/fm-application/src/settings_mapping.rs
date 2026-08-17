//! `Settings` (`fm-settings`) <-> `SettingsDto` (`fm-transport-dto`) conversion.
//!
//! Split out of the `FileManagerService` facade (task 0119) — a self-contained pair of pure
//! conversion functions with no dependency on the rest of the facade.

use fm_settings::{
    ConflictPolicy, DateFormat, DefaultPaneLayout, Language, Settings, SizeFormat, Theme,
};
use fm_transport_dto::{
    ConflictPolicyDto, DateFormatDto, DefaultPaneLayoutDto, LanguageDto, SettingsDto,
    SizeFormatDto, ThemeDto,
};

pub(crate) fn settings_to_dto(settings: Settings) -> SettingsDto {
    SettingsDto {
        schema_version: settings.schema_version,
        theme: match settings.theme {
            Theme::Auto => ThemeDto::Auto,
            Theme::Light => ThemeDto::Light,
            Theme::Dark => ThemeDto::Dark,
        },
        language: match settings.language {
            Language::En => LanguageDto::En,
            Language::Nl => LanguageDto::Nl,
        },
        font_size: settings.font_size,
        row_height: settings.row_height,
        date_format: match settings.date_format {
            DateFormat::Short => DateFormatDto::Short,
            DateFormat::Medium => DateFormatDto::Medium,
            DateFormat::Iso => DateFormatDto::Iso,
        },
        size_format: match settings.size_format {
            SizeFormat::Binary => SizeFormatDto::Binary,
            SizeFormat::Decimal => SizeFormatDto::Decimal,
            SizeFormat::Bytes => SizeFormatDto::Bytes,
        },
        show_hidden_files: settings.show_hidden_files,
        confirm_permanent_delete: settings.confirm_permanent_delete,
        default_conflict_policy: match settings.default_conflict_policy {
            ConflictPolicy::Ask => ConflictPolicyDto::Ask,
            ConflictPolicy::Overwrite => ConflictPolicyDto::Overwrite,
            ConflictPolicy::KeepBoth => ConflictPolicyDto::KeepBoth,
            ConflictPolicy::Skip => ConflictPolicyDto::Skip,
        },
        operation_concurrency: settings.operation_concurrency,
        default_pane_layout: match settings.default_pane_layout {
            DefaultPaneLayout::Dual => DefaultPaneLayoutDto::Dual,
            DefaultPaneLayout::Single => DefaultPaneLayoutDto::Single,
        },
        default_columns: settings.default_columns,
        column_widths: settings.column_widths,
        keybindings: settings.keybindings,
        enabled_plugins: settings.enabled_plugins,
        plugin_settings: serde_json::to_value(settings.plugin_settings)
            .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new())),
        terminal_command: settings.terminal_command,
        editor_command: settings.editor_command,
        default_start_locations: settings.default_start_locations,
        favourite_locations: settings
            .favourite_locations
            .into_iter()
            .map(|favourite| fm_transport_dto::FavouriteLocationDto {
                label: favourite.label,
                location: favourite.location.into(),
            })
            .collect(),
        recent_locations_by_workspace: settings
            .recent_locations_by_workspace
            .into_iter()
            .map(|(workspace_id, locations)| {
                (
                    workspace_id,
                    locations.into_iter().map(Into::into).collect(),
                )
            })
            .collect(),
        icon_theme: settings.icon_theme,
    }
}

pub(crate) fn settings_from_dto(settings: SettingsDto) -> Settings {
    Settings {
        schema_version: fm_settings::CURRENT_SCHEMA_VERSION,
        theme: match settings.theme {
            ThemeDto::Auto => Theme::Auto,
            ThemeDto::Light => Theme::Light,
            ThemeDto::Dark => Theme::Dark,
        },
        language: match settings.language {
            LanguageDto::En => Language::En,
            LanguageDto::Nl => Language::Nl,
        },
        font_size: settings.font_size,
        row_height: settings.row_height,
        date_format: match settings.date_format {
            DateFormatDto::Short => DateFormat::Short,
            DateFormatDto::Medium => DateFormat::Medium,
            DateFormatDto::Iso => DateFormat::Iso,
        },
        size_format: match settings.size_format {
            SizeFormatDto::Binary => SizeFormat::Binary,
            SizeFormatDto::Decimal => SizeFormat::Decimal,
            SizeFormatDto::Bytes => SizeFormat::Bytes,
        },
        show_hidden_files: settings.show_hidden_files,
        confirm_permanent_delete: settings.confirm_permanent_delete,
        default_conflict_policy: match settings.default_conflict_policy {
            ConflictPolicyDto::Ask => ConflictPolicy::Ask,
            ConflictPolicyDto::Overwrite => ConflictPolicy::Overwrite,
            ConflictPolicyDto::KeepBoth => ConflictPolicy::KeepBoth,
            ConflictPolicyDto::Skip => ConflictPolicy::Skip,
        },
        operation_concurrency: settings.operation_concurrency,
        default_pane_layout: match settings.default_pane_layout {
            DefaultPaneLayoutDto::Dual => DefaultPaneLayout::Dual,
            DefaultPaneLayoutDto::Single => DefaultPaneLayout::Single,
        },
        default_columns: settings.default_columns,
        column_widths: settings.column_widths,
        keybindings: settings.keybindings,
        enabled_plugins: settings.enabled_plugins,
        plugin_settings: serde_json::from_value(settings.plugin_settings).unwrap_or_default(),
        terminal_command: settings.terminal_command,
        editor_command: settings.editor_command,
        default_start_locations: settings.default_start_locations,
        favourite_locations: settings
            .favourite_locations
            .into_iter()
            .map(|favourite| fm_settings::FavouriteLocation {
                label: favourite.label,
                location: favourite.location.into(),
            })
            .collect(),
        recent_locations_by_workspace: settings
            .recent_locations_by_workspace
            .into_iter()
            .map(|(workspace_id, locations)| {
                (
                    workspace_id,
                    locations.into_iter().map(Into::into).collect(),
                )
            })
            .collect(),
        icon_theme: settings.icon_theme,
    }
}
