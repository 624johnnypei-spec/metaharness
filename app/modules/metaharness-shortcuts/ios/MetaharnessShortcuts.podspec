Pod::Spec.new do |s|
  s.name = 'MetaharnessShortcuts'
  s.version = '1.0.0'
  s.summary = 'App-scoped keyboard shortcuts'
  s.description = 'A responder-chain host for the Metaharness Remember command.'
  s.license = { :type => 'MIT', :file => '../../../../LICENSE' }
  s.author = 'Metaharness contributors'
  s.homepage = 'https://docs.expo.dev/modules/'
  s.source = { :path => '.' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
